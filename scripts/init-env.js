#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const envPath = path.resolve(process.cwd(), ".env");

const defaults = {
  port: "3000",
  llmToken: "your-llm-api-token",
  llmModel: "gpt-4.1",
  chromaUrl: "",
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (question, fallback) =>
  new Promise((resolve) => {
    const suffix = fallback ? ` (${fallback})` : "";
    rl.question(`${question}${suffix}: `, (answer) => {
      const value = answer.trim();
      resolve(value || fallback);
    });
  });

async function main() {
  if (fs.existsSync(envPath)) {
    const overwrite = (
      await ask(`.env already exists at ${envPath}. Overwrite? y/N`, "n")
    ).toLowerCase();
    if (overwrite !== "y") {
      console.log("Keeping existing .env, no changes made.");
      return;
    }
  }

  const port = await ask("Port", defaults.port);
  const llmToken = await ask("LLM API token", defaults.llmToken);
  const llmModel = await ask("LLM model", defaults.llmModel);
  const chromaUrl = await ask("Chroma URL (optional)", defaults.chromaUrl);

  const lines = [
    `PORT=${port}`,
    `LLM_API_TOKEN=${llmToken}`,
    `LLM_MODEL=${llmModel}`,
  ];

  if (chromaUrl) {
    lines.push(`CHROMA_URL=${chromaUrl}`);
  }

  const content = lines.join("\n");

  fs.writeFileSync(envPath, `${content}\n`);
  console.log(`.env written to ${envPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
