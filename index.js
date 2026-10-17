import express from "express";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import cors from "cors";
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const client = new OpenAI({
    apiKey: process.env.OLLAMA_API_KEY || "ollama",
    baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1"
});
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendOrigins = (process.env.FRONTEND_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const QUESTION_TYPES = {
    mcq: "multiple-choice",
    short_question: "short-answer",
    long_question: "long-answer"
};
const DIFFICULTIES = ["easy", "medium", "hard"];

app.use(express.json());
app.use(cors({ origin: frontendOrigins }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/ask", async (req, res) => {
    const {
        chapter,
        type,
        difficulty,
        assessmentTitle = "Classroom Assessment",
        course = "",
        gradeLevel = "",
        instructions = ""
    } = req.body ?? {};

    if (typeof chapter !== "string" || !chapter.trim()) {
        return res.status(400).json({ error: "Enter the source material or topic for this assessment." });
    }

    if (typeof assessmentTitle !== "string" || !assessmentTitle.trim() || assessmentTitle.length > 100) {
        return res.status(400).json({ error: "Enter an assessment title of 100 characters or fewer." });
    }

    if (
        typeof course !== "string" || course.length > 80 ||
        typeof gradeLevel !== "string" || gradeLevel.length > 50 ||
        typeof instructions !== "string" || instructions.length > 500
    ) {
        return res.status(400).json({ error: "Course, grade, or student instructions exceed the allowed length." });
    }

    if (!type || typeof type !== "object" || Array.isArray(type)) {
        return res.status(400).json({ error: "Choose at least one question type and count." });
    }

    const requestedTypes = Object.entries(type);
    if (
        requestedTypes.length === 0 ||
        requestedTypes.some(([questionType, count]) =>
            !Object.hasOwn(QUESTION_TYPES, questionType) ||
            !Number.isInteger(count) ||
            count < 1 ||
            count > 50
        )
    ) {
        return res.status(400).json({
            error: "Question types must be supported and each count must be an integer from 1 to 50."
        });
    }

    if (!DIFFICULTIES.includes(difficulty)) {
        return res.status(400).json({
            error: `Difficulty must be one of: ${DIFFICULTIES.join(", ")}.`
        });
    }

    const questionDetails = requestedTypes
        .map(([questionType, count]) =>
            `${count} ${QUESTION_TYPES[questionType]} question${count === 1 ? "" : "s"}`
        )
        .join(", ");
    const prompt = [
        "Create a classroom-ready assessment for an educator using only the source material provided below.",
        `Assessment title: ${assessmentTitle.trim()}`,
        course.trim() ? `Course or subject: ${course.trim()}` : "",
        gradeLevel.trim() ? `Student grade or level: ${gradeLevel.trim()}` : "",
        `Create exactly ${questionDetails}.`,
        `Set the overall difficulty to ${difficulty}.`,
        "Use age-appropriate language and assess meaningful understanding of the provided material.",
        "Return only the assessment content, without an introduction, commentary, or sign-off.",
        "Start with a Questions heading. Number each question. Include student-facing questions and choices only in this section; never reveal answers here.",
        "For each multiple-choice question, provide four distinct, plausible options labeled A-D with exactly one correct answer.",
        "After the questions, add an Answer Key heading and one concise correct answer per question, using matching question numbers. Include acceptable key points for long-answer questions.",
        "Follow the requested question counts exactly; do not add types or bonus questions.",
        "",
        "Source material:",
        chapter.trim()
    ].filter(Boolean).join("\n");

    try {
        const response = await client.chat.completions.create({
            model: process.env.OLLAMA_MODEL || "gemma3:270m",
            messages: [
                {
                    role: "system",
                    content: "You are an experienced teacher who writes accurate assessment questions and answer keys."
                },
                { role: "user", content: prompt }
            ]
        });

        return res.json({ answer: response.choices[0]?.message?.content ?? "" });
    } catch (error) {
        console.error("Local model request failed:", error);
        return res.status(502).json({
            error: "The local model request failed. Check that Ollama is running and the configured model is available."
        });
    }
});

app.post("/api/download-pdf", async (req, res) => {
    const {
        markdown,
        assessmentTitle = "Classroom Assessment",
        course = "",
        gradeLevel = "",
        instructions = "",
        includeAnswerKey = true
    } = req.body ?? {};
    if (typeof markdown !== "string" || !markdown.trim()) {
        return res.status(400).json({ error: "There are no questions to download." });
    }

    if (
        typeof assessmentTitle !== "string" || assessmentTitle.length > 100 ||
        typeof course !== "string" || course.length > 80 ||
        typeof gradeLevel !== "string" || gradeLevel.length > 50 ||
        typeof instructions !== "string" || instructions.length > 500 ||
        typeof includeAnswerKey !== "boolean"
    ) {
        return res.status(400).json({ error: "Assessment details are invalid or exceed the allowed length." });
    }

    try {
        const title = assessmentTitle.trim() || "Classroom Assessment";
        const pdf = await createAssessmentPdf(markdown, {
            title,
            course: course.trim(),
            gradeLevel: gradeLevel.trim(),
            instructions: instructions.trim(),
            includeAnswerKey
        });
        const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "classroom-assessment"}.pdf`;
        res.set({
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`
        });
        return res.send(pdf);
    } catch (error) {
        console.error("PDF generation failed:", error);
        return res.status(500).json({ error: "Could not generate the PDF. Please try again." });
    }
});

function createAssessmentPdf(markdown, assessment) {
    const document = new PDFDocument({
        size: "A4",
        margins: { top: 48, right: 54, bottom: 48, left: 54 },
        info: { Title: assessment.title, Author: "Studyforge" }
    });
    const chunks = [];
    const pdfPromise = new Promise((resolve, reject) => {
        document.on("data", (chunk) => chunks.push(chunk));
        document.on("end", () => resolve(Buffer.concat(chunks)));
        document.on("error", reject);
    });

    document.font("Helvetica-Bold").fontSize(19).fillColor("#243b30")
        .text(toPdfText(assessment.title), { align: "center" });
    const metadata = [assessment.course, assessment.gradeLevel].filter(Boolean).join("  |  ");
    if (metadata) {
        document.moveDown(0.25);
        document.font("Helvetica").fontSize(10).fillColor("#66736a")
            .text(toPdfText(metadata), { align: "center" });
    }
    document.moveDown(0.9);
    document.font("Helvetica").fontSize(10).fillColor("#252729")
        .text("Name: ____________________________________     Date: ______________");
    document.moveDown(0.5);
    if (assessment.instructions) {
        document.font("Helvetica-Bold").fontSize(10).text("Instructions");
        document.font("Helvetica").fontSize(10).text(toPdfText(assessment.instructions), { lineGap: 2 });
        document.moveDown(0.5);
    }

    const lines = markdown.split(/\r?\n/);
    const answerKeyIndex = lines.findIndex(isAnswerKeyHeading);
    const questionLines = answerKeyIndex < 0 ? lines : lines.slice(0, answerKeyIndex);
    const answerLines = answerKeyIndex < 0 ? [] : lines.slice(answerKeyIndex + 1);
    writePdfSection(document, questionLines, "Questions");

    if (assessment.includeAnswerKey && answerLines.some((line) => line.trim())) {
        document.addPage();
        document.font("Helvetica-Bold").fontSize(16).fillColor("#315b4a").text("Teacher Answer Key");
        document.moveDown(0.5);
        writePdfLines(document, answerLines);
    }

    document.end();
    return pdfPromise;
}

function isAnswerKeyHeading(line) {
    return /^(?:#{1,3}\s*)?(?:\*{1,2})?(?:answer(?:\s+key)?|solutions?|marking\s+scheme)(?:\*{1,2})?:?$/i
        .test(line.trim());
}

function writePdfSection(document, lines, defaultHeading) {
    const contentLines = [...lines];
    const headingIndex = contentLines.findIndex((line) => /^#{1,3}\s+/.test(line.trim()));
    if (headingIndex >= 0) {
        contentLines.splice(headingIndex, 1);
    }
    document.moveDown(0.25);
    document.font("Helvetica-Bold").fontSize(14).fillColor("#315b4a").text(defaultHeading);
    document.moveDown(0.45);
    document.font("Helvetica").fontSize(11).fillColor("#252729");
    writePdfLines(document, contentLines);
}

function writePdfLines(document, lines) {
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            document.moveDown(0.4);
            continue;
        }

        const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
            document.moveDown(0.65);
            document.font("Helvetica-Bold").fontSize(13).fillColor("#315b4a")
                .text(toPdfText(heading[1]));
            document.moveDown(0.25);
            document.font("Helvetica").fontSize(11).fillColor("#252729");
            continue;
        }

        const numberedItem = line.match(/^\s*(\d+[.)])\s+(.+)$/);
        const bulletItem = line.match(/^(\s*)[-*+]\s+(.+)$/);
        const text = numberedItem
            ? `${numberedItem[1]} ${toPdfText(numberedItem[2])}`
            : bulletItem
                ? `- ${toPdfText(bulletItem[2])}`
                : toPdfText(trimmed);
        document.text(text, {
            indent: bulletItem ? 12 + Math.min(bulletItem[1].length, 4) * 4 : numberedItem ? 8 : 0,
            paragraphGap: 4,
            lineGap: 3
        });
    }
}

function toPdfText(markdown) {
    return markdown
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/^#{1,6}\s*/, "")
        .replace(/[#*]/g, "")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–]/g, "-")
        .replace(/…/g, "...")
        .replace(/[^\x20-\xFF]/g, "?");
}

const PORT = Number(process.env.PORT) || 8000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
