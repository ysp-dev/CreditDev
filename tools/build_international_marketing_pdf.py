import argparse
import json
import re
from html import escape, unescape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


def register_fonts():
    pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
    pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
    return "HYGothic-Medium", "HYSMyeongJo-Medium"


def extract_js_array(source: str, name: str) -> list:
    marker = f"const {name} = "
    start = source.index(marker) + len(marker)
    bracket_start = source.index("[", start)
    depth = 0
    quote = None
    escape_next = False
    for idx in range(bracket_start, len(source)):
        ch = source[idx]
        if quote:
            if escape_next:
                escape_next = False
            elif ch == "\\":
                escape_next = True
            elif ch == quote:
                quote = None
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                raw = source[bracket_start : idx + 1]
                break
    else:
        raise RuntimeError(f"Could not extract {name}")

    json_like = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', raw)
    return json.loads(json_like)


def strip_citations(value: str) -> str:
    text = str(value)
    text = re.sub(r"\s*\[cite:\s*[^\]]+\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def html_to_text(value: str) -> str:
    text = str(value)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(tr|p|div)>", "\n", text)
    text = re.sub(r"(?i)</(td|th)>", " | ", text)
    text = re.sub(r"(?i)<[^>]+>", "", text)
    text = unescape(text)
    text = strip_citations(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def para(text, style):
    return Paragraph(escape(strip_citations(text)).replace("\n", "<br/>"), style)


def make_styles(font, serif):
    styles = getSampleStyleSheet()
    base = ParagraphStyle(
        "KoreanBase",
        parent=styles["Normal"],
        fontName=font,
        fontSize=9.3,
        leading=14,
        textColor=colors.HexColor("#111827"),
        wordWrap="CJK",
        spaceAfter=4,
    )
    body = ParagraphStyle("Body", parent=base)
    small = ParagraphStyle("Small", parent=base, fontSize=8.1, leading=12, textColor=colors.HexColor("#4b5563"))
    title = ParagraphStyle(
        "Title",
        parent=base,
        fontSize=22,
        leading=30,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=10,
    )
    subtitle = ParagraphStyle(
        "Subtitle",
        parent=base,
        fontSize=11,
        leading=16,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#475569"),
        spaceAfter=16,
    )
    h1 = ParagraphStyle(
        "H1",
        parent=base,
        fontSize=15,
        leading=20,
        textColor=colors.HexColor("#1d4ed8"),
        spaceBefore=8,
        spaceAfter=8,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=base,
        fontSize=11.5,
        leading=16,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=8,
        spaceAfter=5,
    )
    q = ParagraphStyle(
        "Question",
        parent=base,
        fontSize=10.2,
        leading=15,
        textColor=colors.HexColor("#111827"),
        spaceBefore=6,
        spaceAfter=5,
    )
    answer = ParagraphStyle(
        "Answer",
        parent=base,
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#14532d"),
        leftIndent=8,
        borderColor=colors.HexColor("#bbf7d0"),
        borderWidth=0.7,
        borderPadding=5,
        backColor=colors.HexColor("#f0fdf4"),
        spaceAfter=6,
    )
    note = ParagraphStyle(
        "Note",
        parent=base,
        fontSize=8.7,
        leading=13,
        textColor=colors.HexColor("#713f12"),
        borderColor=colors.HexColor("#fde68a"),
        borderWidth=0.7,
        borderPadding=5,
        backColor=colors.HexColor("#fffbeb"),
        spaceAfter=7,
    )
    return {
        "body": body,
        "small": small,
        "title": title,
        "subtitle": subtitle,
        "h1": h1,
        "h2": h2,
        "q": q,
        "answer": answer,
        "note": note,
    }


def page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("HYGothic-Medium", 8)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawRightString(A4[0] - 18 * mm, 11 * mm, f"{doc.page}")
    canvas.drawString(18 * mm, 11 * mm, "국제마케팅 연습문제 학습용 정답 정리")
    canvas.restoreState()


def build_table(rows, widths, style):
    table = Table(rows, colWidths=widths, repeatRows=1)
    table.setStyle(style)
    return table


def option_answer_text(question):
    idx = int(question["a"])
    return f"{idx + 1}번. {strip_citations(question['o'][idx])}"


def make_pdf(choice, short, essay, transcript, out_path: Path):
    font, serif = register_fonts()
    styles = make_styles(font, serif)
    doc = BaseDocTemplate(
        str(out_path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title="국제마케팅 연습문제 학습용 정답 정리",
        author="Codex",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([PageTemplate(id="normal", frames=[frame], onPage=page_footer)])

    story = []
    story.append(para("국제마케팅 연습문제\n학습용 정답 정리", styles["title"]))

    story.append(Spacer(1, 6))
    story.append(para("출제 단답형", styles["h1"]))
    short_lookup = {q["n"]: q for q in short}
    expected_extra_short = {
        "label": "예상추가문제",
        "answer": "WIPO (세계지적재산권기구)",
        "question": "지식재산권 관련 분쟁이 잦은 마케팅 계약에서 전문적인 도움을 받기에 가장 유리한 국제 중재 관련 기관은?",
        "note": "원문 단답형에는 없으나 객관식 19번 근거로 임시 추가",
    }
    mentioned_short = [
        (22, "자발적 팬덤", "전사에서 명시 언급"),
        (23, "트랜스크리에이션", "전사에서 명시 언급"),
        (24, "GEO", "전사에서 명시 언급"),
        (27, "패시브", "전사에서 명시 언급"),
    ]
    rows = [[para("문항", styles["small"]), para("정답", styles["small"]), para("문제 요지", styles["small"]), para("표기", styles["small"])]]
    for n, term, note in mentioned_short:
        q = short_lookup[n]
        rows.append([
            para(str(n), styles["small"]),
            para(term, styles["small"]),
            para(q["q"], styles["small"]),
            para(note, styles["small"]),
        ])
    rows.append([
        para(expected_extra_short["label"], styles["small"]),
        para(expected_extra_short["answer"], styles["small"]),
        para(expected_extra_short["question"], styles["small"]),
        para(expected_extra_short["note"], styles["small"]),
    ])
    story.append(
        build_table(
            rows,
            [13 * mm, 35 * mm, 92 * mm, 32 * mm],
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ]
            ),
        )
    )

    story.append(Spacer(1, 8))
    story.append(para("전사 기반 서술형 2문제 상세 정리", styles["h1"]))
    essay_lookup = {q["n"]: q for q in essay}
    detailed = [
        (
            39,
            "허브 앤 스포크 모델",
            [
                "허브는 본사 또는 중앙 조직으로, 핵심 브랜드 메시지와 가이드라인을 통제한다.",
                "스포크는 지역 지사 또는 현지 실행 조직으로, 지역 문화와 미디어 환경에 맞춰 집행한다.",
                "강사는 자전거 바퀴 비유를 사용해 허브와 스포크의 역할 구분을 강조했다.",
                "답안에는 ‘브랜드 정체성 유지’와 ‘지역 특색에 맞춘 현지화’를 함께 써야 한다.",
            ],
        ),
        (
            38,
            "마이크로 인플루언서와 창작의 자유",
            [
                "마이크로 인플루언서는 자신의 팔로워 언어, 유머, 정서를 가장 잘 아는 현지 커뮤니티 전문가다.",
                "기업이 완성된 광고 대본을 강제하면 광고맹을 유발하고 진정성이 약해진다.",
                "기업은 핵심 메시지만 제공하고 표현 방식은 인플루언서에게 맡겨야 한다.",
                "답안에는 ‘창작의 자유’, ‘진정성’, ‘친구의 조언처럼 수용’이라는 논리를 연결해 쓰면 좋다.",
            ],
        ),
    ]
    for n, title, bullets in detailed:
        q = essay_lookup[n]
        story.append(KeepTogether([para(f"서술형 {n}. {title}", styles["h2"]), para(q["q"], styles["q"])]))
        story.append(para(f"채점 기준\n{html_to_text(q['criteria'])}", styles["note"]))
        story.append(ListFlowable([ListItem(para(item, styles["body"])) for item in bullets], bulletType="bullet", leftIndent=14))
        story.append(para(f"모범 답안\n{html_to_text(q['ans'])}", styles["answer"]))

    story.append(PageBreak())
    story.append(para("전체 객관식 정답 및 해설", styles["h1"]))
    for q in choice:
        block = [
            para(f"문항 {q['n']}. {q['q']}", styles["q"]),
            para(f"정답: {option_answer_text(q)}\n해설: {q['e']}", styles["answer"]),
        ]
        options = []
        for idx, opt in enumerate(q["o"], start=1):
            mark = "정답" if idx - 1 == q["a"] else ""
            options.append(ListItem(para(f"{idx}. {opt} {mark}", styles["small"])))
        block.append(ListFlowable(options, bulletType="bullet", leftIndent=12))
        story.append(KeepTogether(block))

    story.append(PageBreak())
    story.append(para("전체 단답형 정답", styles["h1"]))
    rows = [[para("문항", styles["small"]), para("문제", styles["small"]), para("기준/인정 정답", styles["small"])]]
    for q in short:
        rows.append([
            para(str(q["n"]), styles["small"]),
            para(q["q"], styles["small"]),
            para(", ".join(q["a"]), styles["small"]),
        ])
    story.append(
        build_table(
            rows,
            [13 * mm, 102 * mm, 57 * mm],
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dcfce7")),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            ),
        )
    )
    story.append(Spacer(1, 8))
    story.append(para("예상추가문제", styles["h2"]))
    story.append(para(
        f"문제: {expected_extra_short['question']}\n"
        f"정답: {expected_extra_short['answer']}\n"
        f"표기: {expected_extra_short['note']}",
        styles["note"],
    ))

    doc.build(story)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--transcript", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    source = args.html.read_text(encoding="utf-8")
    choice = extract_js_array(source, "choiceQuestions")
    short = extract_js_array(source, "shortQuestions")
    essay = extract_js_array(source, "essayQuestions")
    transcript = args.transcript.read_text(encoding="utf-8").strip()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    make_pdf(choice, short, essay, transcript, args.out)
    print(f"pdf_saved={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
