import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.GRAPHORA_URL || "http://127.0.0.1:4545";
const directory = path.resolve("test-results");
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [],
  external = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    !request.url().startsWith(url) &&
    !request.url().startsWith("data:") &&
    !request.url().startsWith("blob:")
  )
    external.push(request.url());
});
try {
  await page.goto(url);
  await page.getByRole("heading", { name: "Mapa de conhecimento" }).waitFor();
  await page.locator("canvas").first().waitFor();
  await page.waitForTimeout(2500);
  const inspectCanvas = () =>
    page
      .locator(".graph-scene canvas")
      .first()
      .evaluate((canvas) => {
        const copy = document.createElement("canvas");
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext("2d");
        ctx.drawImage(canvas, 0, 0);
        const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let colored = 0,
          lit = 0,
          hash = 0;
        for (let i = 0; i < pixels.length; i += 16) {
          if (
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) -
              Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >
              25 &&
            pixels[i] + pixels[i + 1] + pixels[i + 2] > 200
          )
            colored++;
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 180) lit++;
          hash = (hash + pixels[i] * ((i % 73) + 1)) % 1000000007;
        }
        return {
          width: canvas.width,
          height: canvas.height,
          colored,
          lit,
          hash,
        };
      });
  const first = await inspectCanvas();
  assert.ok(first.colored > 100, `3D graph is blank: ${JSON.stringify(first)}`);
  await page.screenshot({
    path: path.join(directory, "desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Orbitar grafo", exact: true })
    .click();
  await page.waitForTimeout(500);
  const rotated = await inspectCanvas();
  assert.notEqual(
    rotated.hash,
    first.hash,
    "Orbit should move the rendered scene",
  );
  await page.getByRole("button", { name: "Parar orbita", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes do mapa" }).click();
  await page
    .getByRole("slider", { name: "Espessura das conexoes" })
    .fill("1.8");
  await page
    .getByRole("slider", { name: "Opacidade das conexoes" })
    .fill("1.35");
  await page.getByRole("slider", { name: "Escala dos nos" }).fill("1.2");
  await page.getByRole("slider", { name: "Repulsao" }).fill("1.3");
  await page
    .getByRole("slider", { name: "Distancia das conexoes" })
    .fill("1.25");
  await page.getByLabel("Cor das conexoes").selectOption("#83a6a0");
  await page.getByLabel("Fundo do mapa").selectOption("#0b1217");
  await page.waitForTimeout(900);
  assert.equal(
    await page
      .evaluate(() =>
        JSON.parse(localStorage.getItem("graphora:visual-settings:v1")),
      )
      .then((settings) => settings.edgeThickness),
    1.8,
  );
  await page.getByRole("button", { name: "Fechar ajustes" }).click();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByTestId("graph-scene-2d").waitFor();
  await page.waitForTimeout(1400);
  const flat = await inspectCanvas();
  assert.ok(flat.colored > 100, `2D graph is blank: ${JSON.stringify(flat)}`);
  await page.screenshot({
    path: path.join(directory, "desktop-2d.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Ajustes do mapa" }).click();
  await page.getByLabel("Espacamento").selectOption("spacious");
  await page.getByRole("button", { name: "Fechar ajustes" }).click();
  await page.locator(".hub-row").first().click();
  await page.getByText("NO SELECIONADO", { exact: true }).waitFor();
  assert.ok((await page.locator(".connection").count()) > 0);
  await page.getByRole("button", { name: "Fonte", exact: true }).click();
  await page.locator(".source-view pre").waitFor();
  assert.ok((await page.locator(".source-view pre").innerText()).length > 30);
  await page.getByRole("button", { name: "Fechar janela" }).click();
  await page
    .getByRole("button", { name: "Consultar contexto", exact: true })
    .click();
  await page.getByLabel("Pergunta", { exact: true }).fill("project graph");
  await page.getByLabel("Orcamento de tokens").selectOption("600");
  await page
    .getByRole("button", { name: "Recuperar contexto", exact: true })
    .click();
  await page.locator(".context-result pre").waitFor();
  const tokens = await page.locator(".context-result > div .mono").innerText();
  assert.ok(Number(tokens.split(" / ")[0]) <= 600);
  await page.getByRole("button", { name: "Fechar janela" }).click();
  await page.getByRole("button", { name: "Limpar selecao" }).click();
  await page
    .getByLabel("Buscar no mapa", { exact: true })
    .fill("xyz-no-match-xyz");
  await page.getByText("Nenhum no neste recorte.").waitFor();
  await page
    .getByRole("button", { name: "Limpar filtros", exact: true })
    .click();
  await page.getByRole("button", { name: "Ajustes do mapa" }).click();
  await page.getByLabel("Detalhamento").selectOption("all");
  await page.getByLabel("Cores").selectOption("community");
  await page.getByRole("button", { name: "Fechar ajustes" }).click();
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(directory, "desktop-symbols.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Constelacao", exact: true }).click();
  await page.getByText("Sua constelacao", { exact: true }).waitFor();
  await page.screenshot({
    path: path.join(directory, "network.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Projeto", exact: true }).click();
  for (const label of ["Explorador", "Memoria", "Atividade", "Assistentes"]) {
    await page.locator("nav").getByRole("button", { name: label }).click();
    await page.getByRole("heading", { name: label, exact: true }).waitFor();
    assert.ok(await page.locator(".content-view").isVisible());
  }
  await page
    .locator("nav")
    .getByRole("button", { name: "Observatorio" })
    .click();
  await page.waitForTimeout(700);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const mobile = await inspectCanvas();
  assert.ok(mobile.colored > 40, "Mobile graph must render");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "Mobile has horizontal overflow",
  );
  await page.screenshot({
    path: path.join(directory, "mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Abrir navegacao" }).click();
  await page.locator("nav").getByRole("button", { name: "Memoria" }).click();
  await page.getByRole("heading", { name: "Memoria", exact: true }).waitFor();
  assert.ok(
    !(await page
      .locator(".sidebar")
      .evaluate((element) => element.classList.contains("mobile-open"))),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        desktopCanvas: first,
        rotatedCanvas: rotated,
        mobileCanvas: mobile,
        browserErrors: errors,
        externalRequests: external,
        screenshots: directory,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
