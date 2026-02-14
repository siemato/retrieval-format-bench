import { Task } from "../types.ts";

export async function readJsonlTasks(path: string): Promise<Task[]> {
  const text = await Deno.readTextFile(path);
  const tasks: Task[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (let i = 0; i < lines.length; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      tasks.push(obj as Task);
    } catch (err) {
      throw new Error(`Failed to parse JSONL at ${path}:${i + 1}: ${(err as Error).message}`);
    }
  }
  return tasks;
}
