/**
 * Cookies and third-party code across a full visit (SNL-7.1), at 1280×800.
 *
 * - [AC-ST-15] home → send a demo message → switch language in the header → pricing: the only
 *   cookie the browser ends up with is `sendo-lang` (set by the selector), no response carries a
 *   `Set-Cookie` header, and every script (and every other request) is same-origin: no analytics
 *   or other third-party hosts.
 */
import { expect, test } from "@playwright/test";
import { LANG_COOKIE, settle } from "./support";

test.use({ viewport: { width: 1280, height: 800 } });

test("[AC-ST-15] a full visit sets only sendo-lang and loads nothing third-party", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "").origin;
  const thirdParty: string[] = [];
  const setCookie: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== origin) thirdParty.push(`${request.resourceType()} ${request.url()}`);
  });
  context.on("response", async (response) => {
    const header = await response.headerValue("set-cookie").catch(() => null);
    if (header !== null) setCookie.push(`${response.url()}: ${header}`);
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await settle(page);

  const chat = page.getByTestId("demo-chat");
  await chat.getByRole("textbox").fill("Do you have parking?");
  await chat.getByRole("textbox").press("Enter");
  await expect(page.getByTestId("stage-steps")).toHaveAttribute("data-stage", "replied");

  await page
    .getByRole("banner")
    .getByRole("button", { name: /Language/ })
    .click();
  await page.getByRole("menuitem", { name: "Español" }).click();
  await expect(page).toHaveURL(/\/es$/);
  await settle(page);

  await page.getByRole("banner").getByRole("link", { name: "Precios", exact: true }).click();
  await expect(page).toHaveURL(/\/es\/pricing$/);
  await settle(page);

  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual([LANG_COOKIE]);
  expect(setCookie).toEqual([]);
  expect(thirdParty).toEqual([]);
});
