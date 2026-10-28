import type { MenuActionId } from "../../shared/constants";
import type { AppMenuContext, AppMenuItem } from "./types";

const FILTERS = [
  ["Color", "color"],
  ["Date Saved", "savedAt"],
  ["Folder", "folder"],
  ["Rating", "rating"],
  ["Shape", "shape"],
  ["Tag", "tags"],
  ["Type", "type"],
  ["Format", "format"],
  ["File Size", "fileSize"],
  ["Resolution", "width"],
  ["Duration", "duration"],
  ["Annotation", "caption"],
  ["Note", "note"],
  ["URL", "url"],
  ["BPM", "bpm"],
  ["Camera", "cameraModel"],
  ["Font", "fontFamily"],
] as const;

const REVERSE_IMAGE_ENGINES = [
  ["Google Lens", "google-lens"],
  ["Bing", "bing"],
  ["Yandex", "yandex"],
  ["TinEye", "tineye"],
  ["SauceNAO", "saucenao"],
  ["Baidu", "baidu"],
  ["Sogou", "sogou"],
] as const;

export function buildFindSection(context: AppMenuContext): AppMenuItem {
  const { accelerator, sendMenuAction } = context;
  return {
    label: "Find",
    submenu: [
      {
        label: "Search Current View",
        accelerator: accelerator("library.find"),
        registerAccelerator: false,
        click: sendMenuAction("find.search"),
      },
      {
        label: "Search All Saves",
        click: sendMenuAction("find.search-all"),
      },
      {
        label: "Go to Folder",
        click: sendMenuAction("find.go-to-folder"),
      },
      { type: "separator" },
      {
        label: "Add to Folders",
        accelerator: accelerator("save.assign-folders"),
        registerAccelerator: false,
        click: sendMenuAction("find.add-to-folders"),
      },
      {
        label: "Add to Last Used Folder",
        accelerator: accelerator("save.add-to-last-folder"),
        registerAccelerator: false,
        click: sendMenuAction("find.add-to-last-folder"),
      },
      { type: "separator" },
      {
        label: "Toggle Filters",
        click: sendMenuAction("find.filters.toggle"),
      },
      {
        label: "Reset Filters",
        click: sendMenuAction("find.filters.reset"),
      },
      {
        label: "Open Filter",
        submenu: FILTERS.map(([label, field]) => ({
          label,
          click: sendMenuAction(`find.filter.${field}`),
        })),
      },
      { type: "separator" },
      {
        label: "Search by Image",
        submenu: [
          {
            label: "Similar Saves",
            click: sendMenuAction("find.visual-search"),
          },
          { type: "separator" },
          ...REVERSE_IMAGE_ENGINES.map(([label, engine]) => ({
            label,
            click: sendMenuAction(
              `find.reverse-image.${engine}` satisfies MenuActionId,
            ),
          })),
        ],
      },
    ],
  };
}
