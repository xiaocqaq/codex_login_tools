"""geotech 计算单测。

基准值用 Rankine 公式手算校核（φ=30°：Ka=1/3, Kp=3）。
"""

import math

import pytest

from cad_dxf_mcp.geotech import (
    SoilLayer,
    layered_active_pressure,
    rankine_ka,
    rankine_kp,
)


def test_rankine_ka_phi30():
    # Ka = tan^2(30) = 1/3
    assert rankine_ka(30.0) == pytest.approx(1.0 / 3.0, rel=1e-9)


def test_rankine_kp_phi30():
    # Kp = tan^2(60) = 3
    assert rankine_kp(30.0) == pytest.approx(3.0, rel=1e-9)


def test_ka_kp_reciprocal():
    # Ka 与 Kp 互为倒数
    for phi in (0.0, 10.0, 20.0, 35.0):
        assert rankine_ka(phi) * rankine_kp(phi) == pytest.approx(1.0, rel=1e-9)


def test_ka_phi0_is_one():
    assert rankine_ka(0.0) == pytest.approx(1.0, rel=1e-12)


def test_rankine_rejects_bad_phi():
    with pytest.raises(ValueError):
        rankine_ka(-1.0)
    with pytest.raises(ValueError):
        rankine_kp(90.0)


def test_single_cohesionless_layer_no_water():
    # 单层无黏聚力、无水：底部 pa = Ka * gamma * H
    layer = SoilLayer(name="砂", thickness=10.0, gamma=18.0, phi=30.0, cohesion=0.0)
    points = layered_active_pressure([layer])
    top, bottom = points
    assert top.depth == 0.0
    assert top.pa == pytest.approx(0.0)
    assert bottom.depth == pytest.approx(10.0)
    # Ka=1/3, sigma_v=180 -> pa=60
    assert bottom.pa == pytest.approx(60.0, rel=1e-9)


def test_surcharge_raises_top_pressure():
    layer = SoilLayer(name="砂", thickness=5.0, gamma=18.0, phi=30.0)
    points = layered_active_pressure([layer], surcharge=30.0)
    # 顶部 pa = Ka * q = 1/3 * 30 = 10
    assert points[0].pa == pytest.approx(10.0, rel=1e-9)


def test_cohesion_creates_tension_cutoff():
    # 强黏聚力使浅层出现受拉区，pa 截断为 0
    layer = SoilLayer(name="黏土", thickness=6.0, gamma=18.0, phi=20.0, cohesion=20.0)
    points = layered_active_pressure([layer])
    assert points[0].pa == 0.0  # 顶部受拉被截断
    assert points[1].pa >= 0.0


def test_water_table_reduces_effective_stress():
    # 有水位时底部有效应力低于无水位工况
    layer = SoilLayer(name="砂", thickness=10.0, gamma=18.0, phi=30.0, gamma_sat=20.0)
    dry = layered_active_pressure([layer])[1].sigma_v
    wet = layered_active_pressure([layer], water_table_depth=0.0, gamma_water=10.0)[1].sigma_v
    assert wet < dry
    # 全水位以下：sigma_v = (20-10)*10 = 100
    assert wet == pytest.approx(100.0, rel=1e-9)


def test_water_table_mid_layer():
    # 水位穿层：上 5m 天然重度，下 5m 浮重度
    layer = SoilLayer(name="砂", thickness=10.0, gamma=18.0, phi=30.0, gamma_sat=20.0)
    sigma_v = layered_active_pressure(
        [layer], water_table_depth=5.0, gamma_water=10.0
    )[1].sigma_v
    # 18*5 + (20-10)*5 = 90 + 50 = 140
    assert sigma_v == pytest.approx(140.0, rel=1e-9)


def test_multi_layer_continuity():
    layers = [
        SoilLayer(name="填土", thickness=3.0, gamma=17.0, phi=15.0),
        SoilLayer(name="砂", thickness=7.0, gamma=19.0, phi=32.0),
    ]
    points = layered_active_pressure(layers)
    assert len(points) == 4
    # 竖向应力应单调不减
    sigmas = [p.sigma_v for p in points]
    assert sigmas == sorted(sigmas)


def test_empty_layers_rejected():
    with pytest.raises(ValueError):
        layered_active_pressure([])


def test_invalid_layer_rejected():
    with pytest.raises(ValueError):
        SoilLayer(name="坏", thickness=-1.0, gamma=18.0, phi=30.0)
