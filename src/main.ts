import { App, Editor, MarkdownView, Notice, Plugin, TFile, ItemView, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MyPluginSettings, SampleSettingTab } from "./settings";
import Gantt from "frappe-gantt";

//frontmatter 읽기
function getTaskMeta(app: App, file: TFile) {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  
  if (!fm) return null;

  return {
    start: fm.start as string | undefined,
    end: fm.end as string | undefined,
  };
}

const GANTT_VIEW_TYPE = "gantt-view";

type GanttViewState = {
  file?: string; // .gantt 파일 경로
};

export default class MyPlugin extends Plugin {
  settings: MyPluginSettings;

  async onload() {
    this.registerView(GANTT_VIEW_TYPE, (leaf) => new GanttView(leaf));
    this.registerExtensions(["gantt"], GANTT_VIEW_TYPE);

    await this.loadSettings();

    this.addRibbonIcon("chart-gantt", "Open Gantt", async () => {
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

# Gantt Project
`;
    ganttFile = await this.app.vault.create(ganttPath, content);
  }

  let leaf = this.app.workspace.getLeavesOfType(GANTT_VIEW_TYPE)[0];
  if (!leaf) leaf = this.app.workspace.getLeaf("tab");

  await leaf.setViewState({
    type: GANTT_VIEW_TYPE,
    active: true,
    state: { file: ganttFile.path },
  });

  this.app.workspace.revealLeaf(leaf);
});

    this.addSettingTab(new SampleSettingTab(this.app, this));
    }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<MyPluginSettings>);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class GanttView extends ItemView {
  
	private currentFilePath: string | null = null;
  private onModifyRef?: (file: TFile) => void;

	constructor(leaf: WorkspaceLeaf) {
	super(leaf);
	}

	getViewType() {
	return GANTT_VIEW_TYPE;
	}

	getDisplayText() {
	return "Gantt";
	}

  // 이 뷰가 어떤 파일을 보고 있는지 Obsidian이 state로 넘겨줄 때 여기서 받음
	async setState(state: unknown, result: any): Promise<void> {
	const s = state as { file?: string };
	this.currentFilePath = s?.file ?? null;
	await this.render();
	}

	getState(): Record<string, unknown> {
	return { file: this.currentFilePath ?? undefined };
	}

async onOpen() {
  await this.render();
}

async onClose() {}


  private async render() {
  const container = this.contentEl;
  container.empty();

  let suppressClickUntil = 0;
  const suppressMs = 500; // 0.5초 정도면 충분


  // 현재 gantt 파일 찾기
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

  // 같은 폴더의 md 파일 수집
  const mdFiles = this.app.vault
    .getMarkdownFiles()
    .filter((f) => f.parent?.path === folderPath);

  // task 필터링
  const taskFiles = mdFiles.filter((file) => {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.type === "task";
  });

  // 화면 출력
	//container.createEl("p", { text: `Tasks: ${taskFiles.length}` });
	//const ul = container.createEl("ul");
	//for (const f of taskFiles) {
	//ul.createEl("li", { text: f.name });
  //}
	type FrappeTask = {
  id: string;          // frappe 내부용 (안전한 문자열)
  name: string;
  start: string;
  end: string;
  progress: number;
  filePath: string;    // ✅ Obsidian 파일 경로(진짜)
};


	function isYmd(s: unknown): s is string {
	return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
	}

  const taskPathById = new Map<string, string>();

const frappeTasks: FrappeTask[] = taskFiles
  .map((file) => {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const start = fm?.start;
    const end = fm?.end;
    if (!isYmd(start) || !isYmd(end)) return null;

    // frappe-gantt 내부에서 안전하게 쓸 id (슬래시/공백 제거)
    const id = file.path.replace(/[^\w-]/g, "_");

    taskPathById.set(id, file.path); // ✅ 여기 저장

    return {
      id,
      name: file.basename,
      start,
      end,
      progress: Number(fm?.progress ?? 0),
    };
  })
  .filter((x): x is FrappeTask => x !== null);
	
  // gantt 컨테이너 생성
  const ganttContainer = container.createEl("div");
  ganttContainer.style.height = "400px";

  let isDragging = false;

  // frappe gantt 생성
new Gantt(ganttContainer, frappeTasks, {
  view_mode: "Day",
  date_format: "YYYY-MM-DD",

  on_date_change: async (task: any, start: Date, end: Date) => {
    suppressClickUntil = Date.now() + suppressMs;

    const filePath = taskPathById.get(task.id);
    if (!filePath) return;

    await this.updateTaskDates(filePath, start, end);
  },

  on_click: (task: any) => {
    // ✅ 최근 드래그/리사이즈 직후 발생한 클릭은 무시
    if (Date.now() < suppressClickUntil) return;

    const filePath = taskPathById.get(task.id);
    if (!filePath) return;

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) this.app.workspace.getLeaf("tab").openFile(file);
  },
});
}
 
private async updateTaskDates(filePath: string, start: Date, end: Date) {
  const file = this.app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) {
    new Notice("msg"); return;
    return;
  }

  // frappe-gantt 날짜가 UTC/로컬 섞일 수 있어서 "YYYY-MM-DD" 안전 변환
  const toYmdLocal = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const newStart = toYmdLocal(start);
  const newEnd = toYmdLocal(end);

  try {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.type = fm.type ?? "task"; // 혹시 없으면 유지/보정 (선택)
      fm.start = newStart;
      fm.end = newEnd;
    });

    new Notice(`Updated: ${file.basename} (${newStart} ~ ${newEnd})`);
  } catch (e) {
    console.error(e);
    new Notice(`Failed to update frontmatter: ${file.basename}`);
  }
}
}
