"""drawing 生成单测：验证图层、实体、保存往返，不依赖 CAD。"""

import ezdxf
import pytest

from cad_dxf_mcp.drawing import (
    ExcavationGeometry,
    draw_active_pressure_diagram,
    draw_basic_geometry,
    new_document,
    save_dxf,
)
from cad_dxf_mcp.geotech import SoilLayer, layered_active_pressure


def test_new_document_has_standard_layers():
    doc = new_document()
    for name in ("STRUCTURE", "AUXILIARY", "DIMENSION", "TEXT", "PRESSURE"):
        assert name in doc.layers


def test_basic_geometry_creates_lines_and_text():
    geo = ExcavationGeometry(excavation_depth=17.2, embedment_depth=7.8)
    doc = draw_basic_geometry(geo)
    msp = doc.modelspace()
    lines = list(msp.query("LINE"))
    texts = list(msp.query("TEXT"))
    assert len(lines) >= 4  # 地面/坑底/桩中心/桩底
    assert len(texts) >= 3  # 三处标高


def test_basic_geometry_pile_bottom_depth():
    geo = ExcavationGeometry(excavation_depth=17.2, embedment_depth=7.8)
    doc = draw_basic_geometry(geo)
    msp = doc.modelspace()
    ys = []
    for line in msp.query("LINE"):
        ys.append(line.dxf.start.y)
        ys.append(line.dxf.end.y)
    # 最深处应为 -(17.2 + 7.8) = -25.0
    assert min(ys) == pytest.approx(-25.0, rel=1e-9)


def test_basic_geometry_rejects_bad_params():
    with pytest.raises(ValueError):
        ExcavationGeometry(excavation_depth=0.0, embedment_depth=5.0)
    with pytest.raises(ValueError):
        ExcavationGeometry(excavation_depth=5.0, embedment_depth=-1.0)


def test_pressure_diagram_from_geotech():
    layers = [SoilLayer(name="砂", thickness=10.0, gamma=18.0, phi=30.0)]
    points = layered_active_pressure(layers)
    doc = draw_active_pressure_diagram(points)
    msp = doc.modelspace()
    assert len(list(msp.query("LINE"))) >= 2  # 至少两根轴
    # 压力线在 PRESSURE 层
    pressure_lines = [e for e in msp.query("LINE") if e.dxf.layer == "PRESSURE"]
    assert len(pressure_lines) >= 1


def test_pressure_diagram_rejects_empty():
    with pytest.raises(ValueError):
        draw_active_pressure_diagram([])


def test_save_and_reload_roundtrip(tmp_path):
    geo = ExcavationGeometry(excavation_depth=10.0, embedment_depth=4.0)
    doc = draw_basic_geometry(geo)
    out = tmp_path / "geo.dxf"
    save_dxf(doc, str(out))
    assert out.exists()
    # 重新读入应无异常且含实体
    reloaded = ezdxf.readfile(str(out))
    assert len(list(reloaded.modelspace().query("LINE"))) >= 4
