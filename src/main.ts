import { Notice, Plugin, TFile, ItemView, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, GanttSettingTab, GanttPluginSettings } from "./settings";
import Gantt from "frappe-gantt";

const GANTT_VIEW_TYPE = "gantt-view";

type GanttTaskMeta = {
  start?: string;
  end?: string;
  type?: string;
};

type TaskRecord = {
  id: string;
  file: TFile;
  name: string;
  start: string;
  end: string;
  progress: number;
};

type GanttChartEventTask = {
  id: string;
};

export default class GanttPlugin extends Plugin {
  settings: GanttPluginSettings;

  async onload() {
    this.registerView(GANTT_VIEW_TYPE, (leaf) => new GanttView(leaf));
    this.registerExtensions(["gantt"], GANTT_VIEW_TYPE);

    await this.loadSettings();

    this.addRibbonIcon("chart-gantt", "Open gantt", async () => {
      const activeFile = this.app.workspace.getActiveFile();

      if (!activeFile) {
        new Notice("Open any file inside a folder first.");
        return;
      }

      const folder = activeFile.parent;
      if (!folder) {
        new Notice("Cannot determine folder.");
        return;
      }

      const ganttPath = `${folder.path}/Project.gantt`;
      let ganttFile = this.app.vault.getAbstractFileByPath(ganttPath) as TFile | null;

      if (!ganttFile) {
        const content = `---
type: gantt
created: ${new Date().toISOString().slice(0, 10)}
---

# Gantt project
`;
        ganttFile = await this.app.vault.create(ganttPath, content);
      }

      await this.app.workspace.getLeaf(false).openFile(ganttFile);
    });

    this.addSettingTab(new GanttSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<GanttPluginSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class GanttView extends ItemView {
  private currentFilePath: string | null = null;
  private onModifyRef?: (file: TFile) => void;
  private modifyTimer: number | null = null;

  private calculateProgress(file: TFile): number {
    const cache = this.app.metadataCache.getFileCache(file);
    const items = cache?.listItems;

    if (!items || items.length === 0) return 0;

    const todos = items.filter((item) => item.task);

    if (todos.length === 0) return 0;

    const done = todos.filter((item) => item.task === "x").length;
    return Math.round((done / todos.length) * 100);
  }

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return GANTT_VIEW_TYPE;
  }

  getDisplayText(): string {
  if (!this.currentFilePath) return "Gantt";

  const af = this.app.vault.getAbstractFileByPath(this.currentFilePath);
  if (af instanceof TFile) {
    return af.basename; // 확장자 제외 파일명
  }
  return "Gantt";
}

getIcon(): string {
  return "chart-gantt"; 
}

  async setState(state: unknown): Promise<void> {
    const nextState = state as { file?: string };
    this.currentFilePath = nextState.file ?? null;
    await this.render();
  }

  getState(): Record<string, unknown> {
    return { file: this.currentFilePath ?? undefined };
  }

  async onOpen() {
    await this.render();

    this.onModifyRef = (file: TFile) => {
      if (!this.currentFilePath) return;

      const ganttFile = this.app.vault.getAbstractFileByPath(this.currentFilePath);
      if (!(ganttFile instanceof TFile)) return;

      const folderPath = ganttFile.parent?.path;
      if (!folderPath) return;

      if (file.extension === "md" && file.parent?.path === folderPath) {
        const scroller = this.contentEl.querySelector(".gantt-container");
        const prevScroll = scroller?.scrollLeft ?? 0;

        void this.render().then(() => {
          const after = this.contentEl.querySelector(".gantt-container");
          if (after) after.scrollLeft = prevScroll;
        });

        if (this.modifyTimer) {
          window.clearTimeout(this.modifyTimer);
        }

        this.modifyTimer = window.setTimeout(() => {
          void this.render();
        }, 120);
      }
    };

    this.registerEvent(this.app.vault.on("modify", this.onModifyRef));
  }

  async onClose() {
    if (this.modifyTimer) {
      window.clearTimeout(this.modifyTimer);
      this.modifyTimer = null;
    }
  }

  private async render() {
    const container = this.contentEl;
    container.empty();

    const toolbar = container.createDiv({ cls: "gantt-toolbar" });

    const addBtn = toolbar.createEl("button", {
      text: "Add task",
    });


    addBtn.onclick = async () => {
      if (!this.currentFilePath) return;

      const ganttFile = this.app.vault.getAbstractFileByPath(this.currentFilePath);
      if (!(ganttFile instanceof TFile)) return;

      const folder = ganttFile.parent;
      if (!folder) return;

      let index = 1;
      const existingNames = new Set(
        folder.children
          .filter((f): f is TFile => f instanceof TFile)
          .map((f) => f.name),
      );

      while (existingNames.has(`Task ${index}.md`)) {
        index += 1;
      }

      const newPath = `${folder.path}/Task ${index}.md`;

      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      const todayStr = `${y}-${m}-${d}`;

      const content = `---
type: task
start: ${todayStr}
end: ${todayStr}
---
`;

      await this.app.vault.create(newPath, content);
      await this.render();
    };

    const refreshBtn = container.createEl("button", {
    text: "Refresh",
    });

    refreshBtn.onclick = () => {
    this.render(); // 전체 리렌더
    };

    let suppressClickUntil = 0;
    const suppressMs = 500;

    const ganttFile =
      (this.currentFilePath
        ? this.app.vault.getAbstractFileByPath(this.currentFilePath)
        : null) as TFile | null;

    if (!ganttFile) {
      container.createEl("p", {
        text: "No gantt file bound to this view (state.file is empty).",
      });
      return;
    }

    const folderPath = ganttFile.parent?.path;
    if (!folderPath) return;

    const mdFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.parent?.path === folderPath);

    const taskFiles = mdFiles.filter((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter?.type === "task";
    });

    function isYmd(value: unknown): value is string {
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    const taskRecords: TaskRecord[] = taskFiles
      .map((file) => {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as GanttTaskMeta | null | undefined;
        const start = frontmatter?.start;
        const end = frontmatter?.end;

        if (!isYmd(start) || !isYmd(end)) return null;

        return {
          id: file.path.replace(/[^\w-]/g, "_"),
          file,
          name: file.basename,
          start,
          end,
          progress: this.calculateProgress(file),
        };
      })
      .filter((record): record is TaskRecord => record !== null);

    const fileByTaskId = new Map(taskRecords.map((task) => [task.id, task.file]));
    const minRows = 8;
    const needed = Math.max(0, minRows - taskRecords.length);

    for (let i = 0; i < needed; i += 1) {
      taskRecords.push({
        id: `__dummy_${i}`,
        name: "",
        start: taskRecords[0]?.start ?? "2026-02-01",
        end: taskRecords[0]?.start ?? "2026-02-01",
        progress: 0,
        file: ganttFile,
      });
    }

    const ganttContainer = container.createEl("div", { cls: "gantt-container" });
    ganttContainer.setCssProps({ height: "400px" });

    const gantt = new Gantt(
      ganttContainer,
      taskRecords.map((task) => ({
        id: task.id,
        name: task.name,
        start: task.start,
        end: task.end,
        progress: task.progress,
      })),
      {
        view_mode: "Day",
        date_format: "YYYY-MM-DD",
        scroll_to: "",
        on_date_change: async (task: GanttChartEventTask, start: Date, end: Date) => {
          if (task.id.includes("__dummy_")) return;
          suppressClickUntil = Date.now() + suppressMs;

          const file = fileByTaskId.get(task.id);
          if (!file) return;

          await this.updateTaskDates(file, start, end);
        },
        on_click: (task: GanttChartEventTask) => {
          if (task.id.includes("__dummy_")) return;
          if (Date.now() < suppressClickUntil) return;

          const file = fileByTaskId.get(task.id);
          if (file) {
            void this.app.workspace.getLeaf(false).openFile(file);
          }
        },
      },
    );

    window.setTimeout(() => {
      const todayBtn = container.querySelector(".today-button");
      if (todayBtn) {
        todayBtn.addEventListener(
          "click",
          (event) => {
            event.stopImmediatePropagation();
            event.preventDefault();

            const targetDate = new Date();
            targetDate.setDate(targetDate.getDate() - 5);

            gantt.set_scroll_position(targetDate);
          },
          true,
        );
      }
    }, 100);
  }

  private async updateTaskDates(file: TFile, start: Date, end: Date) {
    const toYmdLocal = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const newStart = toYmdLocal(start);
    const newEnd = toYmdLocal(end);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.type = typeof frontmatter.type === "string" ? frontmatter.type : "task";
        frontmatter.start = newStart;
        frontmatter.end = newEnd;
      });
    } catch (error) {
      console.error(error);
      new Notice(`Failed to update frontmatter: ${file.basename}`);
    }
  }
}
