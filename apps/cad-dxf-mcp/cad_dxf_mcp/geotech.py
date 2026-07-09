"""基坑支护确定性计算。

对应评测报告「计算阶段」能力，做成纯函数以避免 LLM 直接算数出错。
所有角度输入为度（°），返回值保留原始精度，展示时再按需圆整。
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class SoilLayer:
    """一层土的物理力学参数。

    name:  土类名称
    thickness: 层厚 (m)
    gamma: 天然重度 (kN/m^3)
    phi:   内摩擦角 (°)
    cohesion: 黏聚力 c (kPa)
    gamma_sat: 饱和重度 (kN/m^3)，缺省用天然重度
    """

    name: str
    thickness: float
    gamma: float
    phi: float
    cohesion: float = 0.0
    gamma_sat: float | None = None

    def __post_init__(self) -> None:
        if self.thickness <= 0:
            raise ValueError(f"层厚必须为正：{self.name} thickness={self.thickness}")
        if self.gamma <= 0:
            raise ValueError(f"重度必须为正：{self.name} gamma={self.gamma}")
        if not 0 <= self.phi < 90:
            raise ValueError(f"内摩擦角需在 [0, 90)：{self.name} phi={self.phi}")
        if self.cohesion < 0:
            raise ValueError(f"黏聚力不能为负：{self.name} c={self.cohesion}")

    def effective_gamma_sat(self) -> float:
        return self.gamma_sat if self.gamma_sat is not None else self.gamma


def rankine_ka(phi_deg: float) -> float:
    """Rankine 主动土压力系数 Ka = tan^2(45 - phi/2)。"""
    _check_phi(phi_deg)
    return math.tan(math.radians(45.0 - phi_deg / 2.0)) ** 2


def rankine_kp(phi_deg: float) -> float:
    """Rankine 被动土压力系数 Kp = tan^2(45 + phi/2)。"""
    _check_phi(phi_deg)
    return math.tan(math.radians(45.0 + phi_deg / 2.0)) ** 2


@dataclass(frozen=True)
class ActivePressurePoint:
    """某深度处的主动土压力结果。"""

    depth: float          # 深度 (m)
    layer: str            # 所在土层
    sigma_v: float        # 竖向有效应力 (kPa)
    ka: float             # 该层主动土压力系数
    pa: float             # 主动土压力强度 (kPa)，不小于 0


def layered_active_pressure(
    layers: list[SoilLayer],
    *,
    surcharge: float = 0.0,
    water_table_depth: float | None = None,
    gamma_water: float = 9.81,
) -> list[ActivePressurePoint]:
    """分层主动土压力（考虑黏聚力与地下水，水土分算）。

    pa = Ka * sigma_v' - 2c*sqrt(Ka)，负值截断为 0（受拉区不承压）。
    在每层顶/底两个关键深度各给一个结果点。

    surcharge: 地面均布超载 (kPa)
    water_table_depth: 地下水位深度 (m)，None 表示无水
    """
    if not layers:
        raise ValueError("至少需要一层土")

    points: list[ActivePressurePoint] = []
    top_depth = 0.0
    sigma_v_top = float(surcharge)  # 层顶竖向有效应力，从超载起算

    for layer in layers:
        bottom_depth = top_depth + layer.thickness
        ka = rankine_ka(layer.phi)
        sqrt_ka = math.sqrt(ka)

        # 层顶
        pa_top = max(0.0, ka * sigma_v_top - 2.0 * layer.cohesion * sqrt_ka)
        points.append(
            ActivePressurePoint(top_depth, layer.name, sigma_v_top, ka, pa_top)
        )

        # 该层有效重度增量（水位以下扣浮力，水土分算）
        sigma_v_bottom = sigma_v_top + _layer_sigma_increment(
            layer, top_depth, bottom_depth, water_table_depth, gamma_water
        )
        pa_bottom = max(0.0, ka * sigma_v_bottom - 2.0 * layer.cohesion * sqrt_ka)
        points.append(
            ActivePressurePoint(bottom_depth, layer.name, sigma_v_bottom, ka, pa_bottom)
        )

        top_depth = bottom_depth
        sigma_v_top = sigma_v_bottom

    return points


def _layer_sigma_increment(
    layer: SoilLayer,
    top: float,
    bottom: float,
    water_table_depth: float | None,
    gamma_water: float,
) -> float:
    """该层从顶到底的竖向有效应力增量（水位以下用浮重度）。"""
    if water_table_depth is None or water_table_depth >= bottom:
        # 全部在水位以上
        return layer.gamma * layer.thickness

    if water_table_depth <= top:
        # 全部在水位以下：浮重度 = 饱和重度 - 水重度
        buoyant = layer.effective_gamma_sat() - gamma_water
        return buoyant * layer.thickness

    # 水位穿过本层
    above = layer.gamma * (water_table_depth - top)
    buoyant = layer.effective_gamma_sat() - gamma_water
    below = buoyant * (bottom - water_table_depth)
    return above + below


def _check_phi(phi_deg: float) -> None:
    if not 0 <= phi_deg < 90:
        raise ValueError(f"内摩擦角需在 [0, 90)：phi={phi_deg}")
