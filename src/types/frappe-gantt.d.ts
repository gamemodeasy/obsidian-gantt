declare module "frappe-gantt" {
  export type GanttTaskInput = {
    id: string;
    name: string;
    start: string;
    end: string;
    progress: number;
  };

  export type GanttOptions = {
    view_mode?: "Day" | "Week" | "Month" | "Year";
    date_format?: string;
    scroll_to?: string;
    on_date_change?: (task: { id: string }, start: Date, end: Date) => void | Promise<void>;
    on_click?: (task: { id: string }) => void;
  };

  export default class Gantt {
    constructor(container: HTMLElement, tasks: GanttTaskInput[], options?: GanttOptions);
    set_scroll_position(date: Date): void;
  }
}
