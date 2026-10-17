const form = document.querySelector("#question-form");
const submitButton = form.querySelector("button[type='submit']");
const buttonLabel = submitButton.querySelector(".button-label");
const resultContent = document.querySelector("#result-content");
const resultStatus = document.querySelector("#result-status");
const downloadButton = document.querySelector("#download-button");
const answerKeyControl = document.querySelector("#answer-key-control");
const includeAnswerKey = document.querySelector("#include-answer-key");
const questionFields = ["mcq", "short_question", "long_question"];
let currentAnswer = "";

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const counts = questionFields.map((field) => [field, Number(formData.get(field))]);
    const invalidCount = counts.some(([, count]) => !Number.isInteger(count) || count < 0 || count > 50);
    if (invalidCount) {
        showError("Each question count must be a whole number from 0 to 50.");
        return;
    }
    const type = Object.fromEntries(counts.filter(([, count]) => count > 0));

    if (Object.keys(type).length === 0) {
        showError("Choose at least one question to create your set.");
        form.elements.mcq.focus();
        return;
    }

    submitButton.disabled = true;
    buttonLabel.textContent = "Creating your questions…";
    resultStatus.className = "result-status";
    resultStatus.textContent = "Preparing your assessment…";
    downloadButton.hidden = true;
    answerKeyControl.hidden = true;
    currentAnswer = "";
    resultContent.classList.remove("has-result");
    resultContent.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "empty-state";
    loading.innerHTML = '<div class="loading-spinner" aria-hidden="true"></div><h3>Drafting your assessment</h3><p>Creating questions from your course material.</p>';
    resultContent.append(loading);

    try {
        const response = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chapter: formData.get("chapter"),
                type,
                difficulty: formData.get("difficulty"),
                assessmentTitle: formData.get("assessmentTitle"),
                course: formData.get("course"),
                gradeLevel: formData.get("gradeLevel"),
                instructions: formData.get("instructions")
            })
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not create your questions. Please try again.");
        }
        if (typeof data.answer !== "string" || !data.answer.trim()) {
            throw new Error("The model returned an empty set. Please try again.");
        }

        const output = document.createElement("div");
        output.className = "result-output";
        appendAssessmentSummary(output, formData);
        renderAnswer(data.answer, output);
        resultContent.replaceChildren(output);
        resultContent.classList.add("has-result");
        currentAnswer = data.answer;
        downloadButton.hidden = false;
        answerKeyControl.hidden = false;
        resultStatus.className = "result-status success";
        resultStatus.textContent = "Assessment ready to review";
    } catch (error) {
        showError(error.message || "Something went wrong. Please try again.");
    } finally {
        submitButton.disabled = false;
        buttonLabel.textContent = "Create my questions";
    }
});

downloadButton.addEventListener("click", async () => {
    if (!currentAnswer || downloadButton.disabled) {
        return;
    }

    downloadButton.disabled = true;
    downloadButton.textContent = "Preparing PDF…";

    try {
        const response = await fetch("/api/download-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                markdown: currentAnswer,
                assessmentTitle: form.elements.assessmentTitle.value,
                course: form.elements.course.value,
                gradeLevel: form.elements.gradeLevel.value,
                instructions: form.elements.instructions.value,
                includeAnswerKey: includeAnswerKey.checked
            })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Could not create the PDF.");
        }

        const pdf = await response.blob();
        const url = URL.createObjectURL(pdf);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${form.elements.assessmentTitle.value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "classroom-assessment"}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resultStatus.className = "result-status success";
        resultStatus.textContent = "Your PDF has been downloaded";
    } catch (error) {
        resultStatus.className = "result-status error";
        resultStatus.textContent = error.message || "Could not download the PDF. Please try again.";
    } finally {
        downloadButton.disabled = false;
        downloadButton.textContent = "Download PDF";
    }
});

function showError(message) {
    resultContent.replaceChildren();
    resultContent.classList.remove("has-result");
    downloadButton.hidden = true;
    answerKeyControl.hidden = true;
    currentAnswer = "";
    const errorMessage = document.createElement("div");
    errorMessage.className = "empty-state";
    errorMessage.innerHTML = "<h3>We couldn't make that set</h3>";
    const description = document.createElement("p");
    description.textContent = message;
    errorMessage.append(description);
    resultContent.append(errorMessage);
    resultStatus.className = "result-status error";
    resultStatus.textContent = "Please check and try again";
}

function appendAssessmentSummary(container, formData) {
    const summary = document.createElement("div");
    summary.className = "assessment-summary";
    const title = document.createElement("h3");
    title.textContent = formData.get("assessmentTitle");
    summary.append(title);

    const details = [formData.get("course"), formData.get("gradeLevel")].filter(Boolean);
    if (details.length) {
        const metadata = document.createElement("p");
        metadata.className = "assessment-summary-meta";
        metadata.textContent = details.join(" · ");
        summary.append(metadata);
    }

    const instructions = formData.get("instructions").trim();
    if (instructions) {
        const label = document.createElement("strong");
        label.className = "instructions-heading";
        label.textContent = "Student instructions";
        const text = document.createElement("p");
        text.textContent = instructions;
        summary.append(label, text);
    }
    container.append(summary);
}

function renderAnswer(markdown, container) {
    let orderedList;
    let currentItem;

    for (const line of markdown.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
            currentItem = undefined;
            continue;
        }

        const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
        const answerKeyHeading = trimmed.match(/^(?:\*{0,2})Answer Key:?(?:\*{0,2})$/i);
        if (heading || answerKeyHeading) {
            const element = document.createElement("h3");
            appendInlineMarkdown(element, heading ? heading[1] : "Answer key");
            container.append(element);
            orderedList = undefined;
            currentItem = undefined;
            continue;
        }

        const numberedItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (numberedItem) {
            if (!orderedList) {
                orderedList = document.createElement("ol");
                container.append(orderedList);
            }
            currentItem = document.createElement("li");
            orderedList.append(currentItem);
            appendInlineMarkdown(currentItem, numberedItem[1]);
            continue;
        }

        const bulletItem = line.match(/^\s+[-*+]\s+(.+)$/);
        if (bulletItem && currentItem) {
            let list = currentItem.querySelector(":scope > ul");
            if (!list) {
                list = document.createElement("ul");
                currentItem.append(list);
            }
            const item = document.createElement("li");
            appendInlineMarkdown(item, bulletItem[1]);
            list.append(item);
            continue;
        }

        const isContinuation = /^\s+/.test(line) && currentItem;
        const paragraph = document.createElement("p");
        appendInlineMarkdown(paragraph, trimmed);
        if (isContinuation) {
            currentItem.append(paragraph);
        } else {
            container.append(paragraph);
            orderedList = undefined;
            currentItem = undefined;
        }
    }
}

function appendInlineMarkdown(element, text) {
    const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
    let cursor = 0;

    for (const match of text.matchAll(tokenPattern)) {
        element.append(document.createTextNode(text.slice(cursor, match.index)));
        const token = match[0];
        const isBold = token.startsWith("**") || token.startsWith("__");
        const isCode = token.startsWith("`");
        const wrapper = document.createElement(isBold ? "strong" : isCode ? "code" : "em");
        wrapper.textContent = token.slice(isBold ? 2 : 1, -(isBold ? 2 : 1));
        element.append(wrapper);
        cursor = match.index + token.length;
    }

    element.append(document.createTextNode(text.slice(cursor)));
}
