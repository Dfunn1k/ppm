// La fuente de íconos a la medida lleva solo los de src/data/ui-icons.json: si el código usa uno
// nuevo y nadie regeneró la lista, ese ícono se vería como texto. Arreglo: node scripts/ui-icons.mjs
// @ts-expect-error: script de Node sin tipos
import { uiIcons } from "../../scripts/ui-icons.mjs";
import listed from "@/data/ui-icons.json";

import { iconFontUrl } from "./iconFontUrl";

test("la lista de íconos de la interfaz está al día", () => {
  expect(listed).toEqual(uiIcons());
});

test("la URL pide los íconos en orden alfabético y sin repetir", () => {
  expect(iconFontUrl(["home", "add", "home"])).toContain("&icon_names=add,home&");
  expect(iconFontUrl(null)).not.toContain("icon_names");
});
