"""
TTS 推理引擎配置 — 设备检测与全局配置单例

设备检测与全局配置单例，供 src 子模块和 tts_server.py 共用。
"""

import torch


def get_cuda_device_info(idx: int):
    """获取 CUDA 设备信息"""
    if not torch.cuda.is_available() or idx >= torch.cuda.device_count():
        return None
    try:
        props = torch.cuda.get_device_properties(idx)
    except Exception:
        return None

    name = props.name
    major, minor = props.major, props.minor
    sm_version = major + minor / 10.0
    mem_gb = props.total_memory / (1024**3)

    if sm_version < 5.3:
        return None

    device = torch.device(f"cuda:{idx}")

    is_16_series = (major == 7 and minor == 5) and ("16" in name)
    if sm_version == 6.1 or is_16_series:
        return device, torch.float32, sm_version, mem_gb

    if sm_version >= 8.0:
        return device, torch.bfloat16, sm_version, mem_gb

    if sm_version >= 7.0:
        return device, torch.float16, sm_version, mem_gb

    return device, torch.float32, sm_version, mem_gb


def get_mps_device_info():
    """获取 Apple Silicon MPS 设备信息"""
    if not torch.backends.mps.is_available():
        return None
    try:
        device = torch.device("mps")
        return device, torch.float32, 0.0, 0.0
    except Exception:
        return None


# ---- 自动检测最佳设备 ----
_device = None
_dtype = None

if torch.cuda.is_available():
    _available = []
    for _i in range(torch.cuda.device_count()):
        _info = get_cuda_device_info(_i)
        if _info is not None:
            _available.append(_info)
    if _available:
        _best = max(_available, key=lambda x: (x[2], x[3]))
        _device = _best[0]
        _dtype = _best[1]

if _device is None:
    _mps = get_mps_device_info()
    if _mps is not None:
        _device = _mps[0]
        _dtype = torch.float32

if _device is None:
    _device = torch.device("cpu")
    _dtype = torch.float32


class Config:
    """TTS 推理配置"""
    def __init__(self):
        self.dtype = _dtype
        self.device = _device
        self.use_flash_attn = False
        self.gpt_cache = None
        self.sovits_cache = None
        self.cnroberta = None


class GlobalConfig:
    """全局配置单例（G2P 等子模块需要）"""
    def __init__(self):
        self.models_dir = None
        self.use_jieba_fast = None
        self.chinese_g2p = None
        self.japanese_g2p = None
        self.english_g2p = None


# src/G2P/__init__.py 通过 `from config import global_config` 引用
global_config = GlobalConfig()
