"""
nori-tts 模型自动下载模块

启动时检查模型文件清单，缺失则自动从 ModelScope (首选) / HuggingFace (备用) 下载。

下载清单:
  1. pretrained_models5.zip (chinokiki/GPTSoVITS-RT, ~1.5GB)
     -> chinese-hubert-base/ (config.json, pytorch_model.bin)
     -> g2p/ (字典 + NLTK 分词数据)
     -> sv/pretrained_eres2netv2w24s4ep4.ckpt
     -> s1v3.ckpt
     -> s2Gv2ProPlus.pth
  2. chinese-roberta-wwm-ext-large PyTorch 模型 (hfl/chinese-roberta-wwm-ext-large)
     -> config.json, tokenizer.json, pytorch_model.bin (~1.3GB)
"""

from __future__ import annotations

import os
import logging
import zipfile
from pathlib import Path

logger = logging.getLogger("model_downloader")

# ---- 模型源 URL ----

# 预训练基础模型 zip (内含 chinese-hubert-base, g2p, sv)
PRETRAINED_MODELSCOPE = (
    "https://modelscope.cn/models/chinokiki/GPTSoVITS-RT/"
    "resolve/master/pretrained_models5.zip"
)
PRETRAINED_HUGGINGFACE = (
    "https://huggingface.co/cnmds/GPTSoVITS-RT/"
    "resolve/main/pretrained_models6.zip?download=true"
)

# CN-RoBERTa PyTorch 模型 — 单独文件模板 (%s 替换文件名)
CNROBERTA_MODELSCOPE_TPL = (
    "https://modelscope.cn/models/hfl/chinese-roberta-wwm-ext-large/"
    "resolve/master/%s"
)

CNROBERTA_FILES = ["config.json", "tokenizer.json", "pytorch_model.bin"]

# ---- 模型文件检查清单 ----
# 每一项: (路径后缀, 检查函数)
MODEL_CHECKS: list[tuple[str, callable]] = [
    ("chinese-hubert-base/config.json", lambda p: p.exists()),
    ("chinese-hubert-base/pytorch_model.bin", lambda p: p.exists()),
    ("chinese-roberta-wwm-ext-large/config.json", lambda p: p.exists()),
    ("chinese-roberta-wwm-ext-large/tokenizer.json", lambda p: p.exists()),
    ("chinese-roberta-wwm-ext-large/pytorch_model.bin", lambda p: p.exists()),
    ("g2p/zh/opencpop-strict.txt", lambda p: p.exists()),
    ("sv/pretrained_eres2netv2w24s4ep4.ckpt", lambda p: p.exists()),
    ("s1v3.ckpt", lambda p: p.exists()),
    ("s2Gv2ProPlus.pth", lambda p: p.exists()),
]


def _get_models_dir() -> str:
    """返回 models_dir，优先从全局状态读取"""
    from config import global_config
    if global_config.models_dir:
        return global_config.models_dir
    return "models"


# ---------------------------------------------------------------------------
# 内部工具 (延迟导入 requests / tqdm，避免增加服务启动耗时)
# ---------------------------------------------------------------------------

def _check_model_files(models_dir: str) -> list[str]:
    """返回缺失的文件路径列表"""
    base = Path(models_dir)
    missing = []
    for rel_path, check_fn in MODEL_CHECKS:
        if not check_fn(base / rel_path):
            missing.append(rel_path)
    return missing


def _download_file(url: str, filepath: Path, desc: str = "") -> None:
    """流式下载单个文件，可设置代理"""
    import requests
    from tqdm import tqdm

    filepath.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Downloading {desc or filepath.name} from {url}")
    resp = requests.get(url, stream=True, timeout=30)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    block = 1024 * 1024  # 1MB

    with open(filepath, "wb") as f, tqdm(
        total=total, unit="B", unit_scale=True, desc=desc or filepath.name
    ) as pbar:
        for chunk in resp.iter_content(block):
            if chunk:
                f.write(chunk)
                pbar.update(len(chunk))

    actual = filepath.stat().st_size
    if total > 0 and actual < total:
        raise RuntimeError(
            f"Download incomplete: {actual} bytes < expected {total} bytes"
        )
    logger.info(f"Downloaded: {filepath} ({actual} bytes)")


def _unzip(zip_path: Path, extract_to: Path) -> None:
    """解压 zip 到目标目录"""
    logger.info(f"Extracting {zip_path} -> {extract_to} ...")
    with zipfile.ZipFile(str(zip_path), "r") as z:
        z.extractall(str(extract_to))
    logger.info("Extraction complete")


def _try_download(url: str, filepath: Path, desc: str = "") -> bool:
    """尝试下载，失败返回 False"""
    try:
        _download_file(url, filepath, desc=desc)
        return True
    except Exception as e:
        logger.warning(f"Download failed ({desc}): {e}")
        return False


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def ensure_models(models_dir: str | None = None, proxy: str | None = None) -> None:
    """
    检查并自动下载缺失的模型文件。

    参数:
        models_dir: 模型目录路径。为 None 时从 global_config 读取。
        proxy: HTTP 代理地址，如 "http://proxy.example.com:9999"
    """
    # 解析 models_dir
    if models_dir is None:
        models_dir = _get_models_dir()
    models_dir = str(models_dir)
    md_path = Path(models_dir)

    # 设置代理
    if proxy:
        os.environ.setdefault("HTTP_PROXY", proxy)
        os.environ.setdefault("HTTPS_PROXY", proxy)

    # 1. 检查哪些文件缺失
    missing = _check_model_files(models_dir)
    if not missing:
        logger.info("All auxiliary models already exist, skipping download.")
        return

    need_pretrained = any(
        m.startswith(("chinese-hubert-base", "g2p", "sv", "s1v3", "s2Gv2ProPlus")) for m in missing
    )
    need_cnroberta = any(
        m.startswith("chinese-roberta-wwm-ext-large") for m in missing
    )

    logger.info(
        f"Auxiliary models missing: {missing}"
        f"  (pretrained_zip={need_pretrained}, cnroberta={need_cnroberta})"
    )

    # 2. 下载并解压 pretrained_models zip
    if need_pretrained:
        zip_path = md_path / "pretrained_models5.zip"
        ok = _try_download(
            PRETRAINED_MODELSCOPE, zip_path, desc="pretrained_models"
        )
        if not ok:
            ok = _try_download(
                PRETRAINED_HUGGINGFACE, zip_path, desc="pretrained_models"
            )
        if ok:
            _unzip(zip_path, md_path)
            zip_path.unlink(missing_ok=True)
        else:
            logger.error(
                "Failed to download pretrained_models from both ModelScope and HF."
            )

    # 3. 下载 chinese-roberta-wwm-ext-large (PyTorch)
    if need_cnroberta:
        roberta_dir = md_path / "chinese-roberta-wwm-ext-large"
        roberta_dir.mkdir(parents=True, exist_ok=True)

        for fname in CNROBERTA_FILES:
            fp = roberta_dir / fname
            if fp.exists():
                logger.info(f"  {fname} already exists, skipping")
                continue

            # 仅 ModelScope (hfl/chinese-roberta-wwm-ext-large)
            file_url = CNROBERTA_MODELSCOPE_TPL % fname
            ok = _try_download(file_url, fp, desc=f"cnroberta/{fname}")
            if not ok:
                logger.error(f"Failed to download {fname} from ModelScope.")

    # 4. 最终检查
    still_missing = _check_model_files(models_dir)
    if still_missing:
        logger.warning(
            "Some auxiliary models are still missing after auto-download:\n  "
            + "\n  ".join(still_missing)
        )
    else:
        logger.info("All auxiliary models are ready!")
