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
  private modifyTimer: number | null = null;

// task 파일의 체크박스 상태로 진행률 계산
  private calculateProgress(file: TFile): number {
  const cache = this.app.metadataCache.getFileCache(file);
  const items = cache?.listItems;

  if (!items || items.length === 0) return 0;

  // 체크박스만 필터
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

  this.onModifyRef = (file: TFile) => {
    if (!this.currentFilePath) return;

    const ganttFile = this.app.vault.getAbstractFileByPath(this.currentFilePath);
    if (!(ganttFile instanceof TFile)) return;

    const folderPath = ganttFile.parent?.path;
    if (!folderPath) return;

    // 같은 폴더의 md 파일만 반응
    if (file.extension === "md" && file.parent?.path === folderPath) {

      // 🔥 스크롤 위치 저장
      const scroller = this.contentEl.querySelector(".gantt-container") as HTMLElement;
      const prevScroll = scroller?.scrollLeft ?? 0;

      this.render().then(() => {
        const after = this.contentEl.querySelector(".gantt-container") as HTMLElement;
        if (after) after.scrollLeft = prevScroll;
      });
    
    if  (this.modifyTimer) {
      window.clearTimeout(this.modifyTimer);
    }

    this.modifyTimer = window.setTimeout(() => {
      this.render();
    }, 120); //100~150ms 정도면 충분히 모아서 렌더링 가능
  }
  };

  //this.app.vault.on("modify", this.onModifyRef);
}

async onClose() {  if (this.onModifyRef) {
    this.app.vault.off("modify", this.onModifyRef);
    this.onModifyRef = undefined;
  }
}

  private async render() {
  const container = this.contentEl;
  container.empty();

    // 260223 ====== ✅ 툴바 생성 ======
  const toolbar = container.createDiv({ cls: "gantt-toolbar" });

  const addBtn = toolbar.createEl("button", {
    text: "+ Task",
  });

  addBtn.onclick = async () => {
    if (!this.currentFilePath) return;

    const ganttFile = this.app.vault.getAbstractFileByPath(this.currentFilePath);
    if (!(ganttFile instanceof TFile)) return;

    const folder = ganttFile.parent;
    if (!folder) return;

    // 중복 방지 이름 생성
   let index = 1;
    const existingNames = new Set(
    folder.children
    .filter((f) => f instanceof TFile)
    .map((f) => f.name)
    );

    while (existingNames.has(`Task ${index}.md`)) {
    index++;
    }

    const newPath = `${folder.path}/Task ${index}.md`;

    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${d}`;
    
    // 기본 frontmatter 포함한 템플릿 내용
    const content = `---
type: task
start: ${todayStr}
end: ${todayStr}
---
`;

    const newFile = await this.app.vault.create(newPath, content);

    // 새 파일 열기 (원하면 유지)
    await this.app.workspace.getLeaf("tab").openFile(newFile);

    // 뷰 갱신
    await this.render();
  };

  //이상 260223 테스크버튼 추가

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

type TaskRecord = {
  id: string;
  file: TFile;
  name: string;
  start: string;
  end: string;
  progress: number;
};



  function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const taskRecords: TaskRecord[] = taskFiles
  .map((file) => {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const start = fm?.start;
    const end = fm?.end;
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
  .filter((x): x is TaskRecord => x !== null);

  //Minimal rows for better UX
    const fileByTaskId = new Map(taskRecords.map((t) => [t.id, t.file]));
    const MIN_ROWS = 8;
    const realCount = taskRecords.length;
    const needed = Math.max(0, MIN_ROWS - realCount);

  for (let i = 0; i < needed; i++) {
    taskRecords.push({
     id: `__dummy_${i}`,
     name: "",
     start: taskRecords[0]?.start ?? "2026-02-01",
     end: taskRecords[0]?.start ?? "2026-02-01",
     progress: 0,
     file: ganttFile, // ✅ 유효한 TFile 아무거나 (여기선 ganttFile)
    });
  }
	
  // gantt 컨테이너 생성
  const ganttContainer = container.createEl("div");
  ganttContainer.style.height = "400px";

  let isDragging = false;

  // frappe gantt 생성
const gantt = new Gantt(
  ganttContainer,
  taskRecords.map((t) => ({
    id: t.id,
    name: t.name,
    start: t.start,
    end: t.end,
    progress: t.progress,
  })),
  {
    view_mode: "Day",
    date_format: "YYYY-MM-DD",
    scroll_to: "",


    
    on_date_change: async (task: any, start: Date, end: Date) => {
      if (String(task.id).includes("__dummy_")) return;
      suppressClickUntil = Date.now() + suppressMs;

      const file = fileByTaskId.get(task.id);
      if (!file) return;

      await this.updateTaskDates(file, start, end);
        // ✅ 드래그 끝난 뒤에만 전체 재렌더
        //this.render();
    },

    on_click: (task: any) => {
      if (String(task.id).includes("__dummy_")) return;
      if (Date.now() < suppressClickUntil) return;

      const file = fileByTaskId.get(task.id);
      if (file) this.app.workspace.getLeaf("tab").openFile(file);
    },
  }
);

// 2. 렌더링 직후 'Today' 버튼의 이벤트를 가로챕니다.
  // Frappe Gantt가 DOM을 그리는 시간을 약간 벌어주기 위해 setTimeout을 사용합니다.
  setTimeout(() => {
    const todayBtn = container.querySelector('.today-button');
    if (todayBtn) {
      todayBtn.addEventListener('click', (e) => {
        // Frappe Gantt의 기본 스크롤 동작을 완전히 차단합니다.
        e.stopImmediatePropagation(); 
        e.preventDefault();

        // 3. 원하는 도착 지점 계산 (예: 오늘 날짜로부터 3일 전을 화면 왼쪽에 맞춤)
        // 이렇게 하면 '오늘' 날짜가 화면의 약간 오른쪽(중앙 부근)에 예쁘게 위치하게 됩니다.
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 5); 
        
        gantt.set_scroll_position(targetDate);
      }, true); // true(캡처링 단계)로 설정하여 기본 이벤트보다 먼저 실행되게 합니다.
    }
  }, 100); 

} // render() 종료

private async updateTaskDates(file: TFile, start: Date, end: Date) {
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
      fm.type = fm.type ?? "task";
      fm.start = newStart;
      fm.end = newEnd;
    });
  } catch (e) {
    console.error(e);
    new Notice(`Failed to update frontmatter: ${file.basename}`);
  }
}
}
