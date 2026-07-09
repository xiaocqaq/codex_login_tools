"""基坑支护 DXF 生成（基于 ezdxf）。

对应评测报告「画图阶段」：基础几何、土压力分布图。
产物为可编辑 DXF；无状态、纯参数进→文件出，适合本机 MCP 工具封装。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import ezdxf
from ezdxf.document import Drawing

# 设计院常用图层约定（名称, AutoCAD 颜色号）
_LAYERS: list[tuple[str, int]] = [
    ("STRUCTURE", 1),   # 结构线（红）
    ("AUXILIARY", 8),   # 辅助线（灰）
    ("DIMENSION", 3),   # 标注线（绿）
    ("TEXT", 7),        # 文字（白/黑）
    ("PRESSURE", 5),    # 土压力线（蓝）
]


@dataclass
class ExcavationGeometry:
    """基坑支护基础几何参数（单位 m，标高向下为正深度）。"""

    excavation_depth: float          # 基坑深度
    embedment_depth: float           # 嵌固深度
    pile_top_elevation: float = 0.0  # 桩顶标高（默认 0）
    width: float = 20.0              # 图面宽度（自然地面线长度）

    def __post_init__(self) -> None:
        if self.excavation_depth <= 0:
            raise ValueError("基坑深度必须为正")
        if self.embedment_depth <= 0:
            raise ValueError("嵌固深度必须为正")


def new_document() -> Drawing:
    """新建带标准图层的 DXF 文档。"""
    doc = ezdxf.new(dxfversion="R2010", setup=True)
    for name, color in _LAYERS:
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    return doc


def draw_basic_geometry(geo: ExcavationGeometry) -> Drawing:
    """绘制基坑支护基础几何：自然地面线、坑底线、桩中心线、桩底线。

    坐标系：x 向右，y 向上；地面 y=0，向下为负。
    """
    doc = new_document()
    msp = doc.modelspace()

    top = geo.pile_top_elevation
    ground_y = top
    pit_bottom_y = top - geo.excavation_depth
    pile_bottom_y = pit_bottom_y - geo.embedment_depth
    half = geo.width / 2.0

    # 自然地面线（辅助层）
    msp.add_line((-half, ground_y), (half, ground_y), dxfattribs={"layer": "AUXILIARY"})
    # 坑底线（结构层）
    msp.add_line((-half, pit_bottom_y), (0, pit_bottom_y), dxfattribs={"layer": "STRUCTURE"})
    # 支护桩中心线（结构层）：从桩顶到桩底
    msp.add_line((0, top), (0, pile_bottom_y), dxfattribs={"layer": "STRUCTURE"})
    # 桩底线（结构层）
    msp.add_line((-half, pile_bottom_y), (half, pile_bottom_y), dxfattribs={"layer": "STRUCTURE"})

    # 关键标高文字
    _add_text(msp, f"自然地面 ±0.000", (half * 0.55, ground_y + 0.3))
    _add_text(msp, f"坑底 -{geo.excavation_depth:.3f}", (-half * 0.95, pit_bottom_y + 0.3))
    _add_text(msp, f"桩底 -{geo.excavation_depth + geo.embedment_depth:.3f}",
              (-half * 0.95, pile_bottom_y + 0.3))

    return doc


def draw_active_pressure_diagram(points, *, scale: float = 0.02) -> Drawing:
    """绘制主动土压力分布图。

    points: geotech.layered_active_pressure 的返回（含 depth, pa）。
    scale:  压力→图面水平长度的比例 (m per kPa)。
    """
    if not points:
        raise ValueError("至少需要一个压力点")

    doc = new_document()
    msp = doc.modelspace()

    # 深度轴（竖直）与压力轴（水平）
    max_depth = max(p.depth for p in points)
    msp.add_line((0, 0), (0, -max_depth), dxfattribs={"layer": "DIMENSION"})
    msp.add_line((0, 0), (max(p.pa for p in points) * scale + 1.0, 0),
                 dxfattribs={"layer": "DIMENSION"})

    # 主动土压力分布线（PRESSURE 层）
    prev = None
    for p in points:
        x = p.pa * scale
        y = -p.depth
        if prev is not None:
            msp.add_line(prev, (x, y), dxfattribs={"layer": "PRESSURE"})
        # 水平引线 + 数值标注
        msp.add_line((0, y), (x, y), dxfattribs={"layer": "AUXILIARY"})
        _add_text(msp, f"{p.pa:.1f} kPa @ -{p.depth:.2f}", (x + 0.3, y))
        prev = (x, y)

    return doc


def save_dxf(doc: Drawing, path: str) -> str:
    """保存 DXF，返回路径。"""
    doc.saveas(path)
    return path


def _add_text(msp, text: str, pos, height: float = 0.4) -> None:
    msp.add_text(
        text, dxfattribs={"layer": "TEXT", "height": height}
    ).set_placement(pos)
