import { expect, test } from "vitest";
import * as clean from "@/src/app/api/clean/[...path]/route";
import * as translate from "@/src/app/api/translate/route";
import * as settings from "@/src/app/api/extension/settings/route";
import * as publishBack from "@/src/app/api/extension/publish-back/route";
import * as append from "@/src/app/api/extension/workspace/append/route";

test.each([
  ["clean", clean, ["DELETE", "GET", "POST"]],
  ["translate", translate, ["POST"]],
  ["settings", settings, ["GET", "OPTIONS", "POST"]],
  ["publish-back", publishBack, ["GET", "OPTIONS", "POST"]],
  ["append", append, ["GET", "OPTIONS", "POST"]],
])("%s exports only Next route handlers", (_name, module, allowed) => {
  expect(Object.keys(module).sort()).toEqual(allowed);
});
