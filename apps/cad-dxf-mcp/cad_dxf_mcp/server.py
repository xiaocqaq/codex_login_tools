"""cad-dxf-mcp MCP server（薄封装，逻辑全在已单测的 geotech / drawing）。

真机运行需 `pip install "cad-dxf-mcp[mcp]"`。核心计算/绘图不依赖 mcp SDK，
本机可直接 pytest；本文件只把它们暴露为 MCP 工具，产物写本地路径、不出机。

安全：只暴露确定性计算与 DXF 生成，无任意代码执行/无差别删除。
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .drawing import (
    ExcavationGeometry,
    draw_active_pressure_diagram,
    draw_basic_geometry,
    save_dxf,
)
from .geotech import SoilLayer, layered_active_pressure, rankine_ka, rankine_kp


def _to_layers(raw: list[dict[str, Any]]) -> list[SoilLayer]:
    return [
        SoilLayer(
            name=str(item["name"]),
            thickness=float(item["thickness"]),
            gamma=float(item["gamma"]),
            phi=float(item["phi"]),
            cohesion=float(item.get("cohesion", 0.0)),
            gamma_sat=(float(item["gamma_sat"]) if item.get("gamma_sat") is not None else None),
        )
        for item in raw
    ]


def build_server():  # pragma: no cover - 需 mcp SDK，真机运行
    """构造 FastMCP server 并注册工具。"""
    from mcp.server.fastmcp import FastMCP

    mcp = FastMCP("cad-dxf-mcp")

    @mcp.tool()
    def earth_pressure_coefficients(phi_deg: float) -> dict[str, float]:
        """计算 Rankine 主动/被动土压力系数 Ka、Kp（phi 单位：度）。"""
        return {"ka": rankine_ka(phi_deg), "kp": rankine_kp(phi_deg)}

    @mcp.tool()
    def layered_active_pressure_table(
        layers: list[dict[str, Any]],
        surcharge: float = 0.0,
        water_table_depth: float | None = None,
    ) -> list[dict[str, Any]]:
        """分层主动土压力表。layers 每项含 name/thickness/gamma/phi[/cohesion/gamma_sat]。"""
        points = layered_active_pressure(
            _to_layers(layers),
            surcharge=surcharge,
            water_table_depth=water_table_depth,
        )
        return [asdict(p) for p in points]

    @mcp.tool()
    def basic_geometry_dxf(
        excavation_depth: float,
        embedment_depth: float,
        output_path: str,
        pile_top_elevation: float = 0.0,
    ) -> dict[str, Any]:
        """生成基坑支护基础几何 DXF 到 output_path（本机路径），返回保存路径。"""
        geo = ExcavationGeometry(
            excavation_depth=excavation_depth,
            embedment_depth=embedment_depth,
            pile_top_elevation=pile_top_elevation,
        )
        path = save_dxf(draw_basic_geometry(geo), output_path)
        return {"saved": path, "pile_bottom_depth": excavation_depth + embedment_depth}

    @mcp.tool()
    def active_pressure_dxf(
        layers: list[dict[str, Any]],
        output_path: str,
        surcharge: float = 0.0,
        water_table_depth: float | None = None,
    ) -> dict[str, Any]:
        """由土层参数计算并生成主动土压力分布图 DXF 到 output_path。"""
        points = layered_active_pressure(
            _to_layers(layers),
            surcharge=surcharge,
            water_table_depth=water_table_depth,
        )
        path = save_dxf(draw_active_pressure_diagram(points), output_path)
        return {"saved": path, "max_pa": max(p.pa for p in points)}

    return mcp


def main() -> None:  # pragma: no cover - 真机入口
    build_server().run()


if __name__ == "__main__":  # pragma: no cover
    main()
