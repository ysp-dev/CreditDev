import argparse
import json
import mimetypes
import re
import ssl
import sys
import urllib.request
from pathlib import Path


def read_api_key(env_path: Path) -> str:
    text = env_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(r"sk-(?:proj-)?[A-Za-z0-9_\-]+", text)
    if not match:
        raise RuntimeError(f"OpenAI API key not found in {env_path}")
    return match.group(0)


def multipart_body(fields, files, boundary: str) -> bytes:
    chunks = []
    dash = f"--{boundary}\r\n".encode()
    for name, value in fields.items():
        chunks.extend([
            dash,
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode("utf-8"),
            b"\r\n",
        ])
    for name, path in files.items():
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.extend([
            dash,
            f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode(),
            f"Content-Type: {ctype}\r\n\r\n".encode(),
            data,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks)


def transcribe(api_key: str, audio_path: Path) -> dict:
    boundary = "----codex-gpt4o-transcribe-boundary"
    body = multipart_body(
        {
            "model": "gpt-4o-transcribe",
            "language": "ko",
            "response_format": "json",
            "prompt": (
                "국제마케팅 시험 문제 풀이 강의 녹음입니다. 단답형 후보 용어에는 크로스보더, 자발적 팬덤, "
                "트랜스크리에이션, GEO, 답변 우선 구조, 외부 언급, 패시브, 극단 긍정 성향, "
                "불가항력 조항, 조선미녀, Beauty of Joseon이 있습니다. 서술형 후보에는 허브 앤 스포크, "
                "마이크로 인플루언서, 창작의 자유, 진정성, 광고맹이 있습니다. 강사가 말한 문제 번호와 용어를 정확히 전사해 주세요."
            ),
        },
        {"file": audio_path},
        boundary,
    )
    request = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=120, context=context) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    api_key = read_api_key(args.env)
    result = transcribe(api_key, args.audio)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(result.get("text", "").strip() + "\n", encoding="utf-8")
    args.out.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"transcript_saved={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
