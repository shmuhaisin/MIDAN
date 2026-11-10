"""Build step for the AI service image (services/ai/Dockerfile): the two matching models, at pinned revisions.

    python fetch_models.py fetch                 download them into HF_HOME (needs the network, once, at build time)
    HF_HUB_OFFLINE=1 python fetch_models.py check   load both offline, by name, as the service does, and score one pair

The service never downloads at runtime (HF_HUB_OFFLINE=1). Only the files sentence-transformers reads are fetched, not the
ONNX and OpenVINO copies or the duplicate pytorch_model.bin: about 1.1 GB for e5 and 2.1 GB for the reranker.
"""

import sys
from pathlib import Path

MODELS = {
    "intfloat/multilingual-e5-base": ("d128750597153bb5987e10b1c3493a34e5a4502a", [
        "config.json", "model.safetensors", "modules.json", "sentence_bert_config.json", "1_Pooling/config.json",
        "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json"]),
    "BAAI/bge-reranker-v2-m3": ("953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e", [
        "config.json", "model.safetensors", "sentencepiece.bpe.model", "special_tokens_map.json", "tokenizer.json",
        "tokenizer_config.json"]),
}


def fetch() -> None:
    from huggingface_hub import snapshot_download
    from huggingface_hub.constants import HF_HUB_CACHE

    for repo, (revision, files) in MODELS.items():
        snapshot_download(repo, revision=revision, allow_patterns=files)
        # The service loads by name, which resolves "main" from the cache when offline; a download pinned to a commit
        # doesn't record that, so it's written here, pointing at the pinned commit.
        ref = Path(HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / "refs" / "main"
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.write_text(revision)
        print(f"fetched {repo}@{revision[:10]}")


def check() -> None:
    from huggingface_hub.constants import HF_HUB_OFFLINE
    from sentence_transformers import CrossEncoder, SentenceTransformer

    if not HF_HUB_OFFLINE:
        sys.exit("check must run with HF_HUB_OFFLINE=1, as the service does")
    e5_name, reranker_name = MODELS
    e5 = SentenceTransformer(e5_name, device="cpu")
    vectors = e5.encode(["query: SQL reporting", "passage: Built SQL reports for managers"], normalize_embeddings=True)
    reranker = CrossEncoder(reranker_name, device="cpu", max_length=256)
    relevance = float(reranker.predict([("SQL reporting", "Built SQL reports for managers")])[0])
    similarity = float(vectors[0] @ vectors[1])
    if not (0 < similarity <= 1 and 0 < relevance <= 1):
        sys.exit(f"unexpected scores: e5 {similarity}, reranker {relevance}")
    print(f"offline check passed: e5 similarity {similarity:.3f}, reranker relevance {relevance:.3f}")


if __name__ == "__main__":
    {"fetch": fetch, "check": check}[sys.argv[1] if len(sys.argv) > 1 else ""]()
