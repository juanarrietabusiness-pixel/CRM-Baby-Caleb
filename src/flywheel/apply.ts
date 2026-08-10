/**
 * Applying a flywheel suggestion — the owner's one click.
 *
 *  • kb_entry → creates a kb_doc and indexes it into Vectorize immediately
 *    (reuses the Conocimiento pipeline), so the gap closes on the next message.
 *  • leccion → appends the rule to the learned_lessons setting (FIFO, capped),
 *    which the generated system prompt injects as <lecciones_aprendidas>.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SuggestionsRepo } from "../db/suggestions";
import { KbDocsRepo, indexDoc } from "../kb/docs";
import { getLessons, saveLessons, MAX_LESSONS } from "./detect";

export async function applySuggestion(env: Env, id: string): Promise<boolean> {
  const repo = new SuggestionsRepo(new Db(env.DB));
  const s = await repo.getById(id);
  if (!s || s.status !== "proposed") return false;

  let payload: any = {};
  try {
    payload = JSON.parse(s.payload);
  } catch {
    return false;
  }

  if (s.kind === "kb_entry") {
    const title = String(payload.title ?? s.title).slice(0, 200);
    const content = String(payload.content ?? "").trim();
    if (!content) return false;
    const docs = new KbDocsRepo(new Db(env.DB));
    const docId = crypto.randomUUID();
    await docs.upsert({ id: docId, title, content });
    const doc = (await docs.getById(docId))!;
    await indexDoc(env, doc);
  } else if (s.kind === "leccion") {
    const lesson = String(payload.lesson ?? s.title).trim();
    if (!lesson) return false;
    const lessons = await getLessons(env);
    if (!lessons.includes(lesson)) {
      lessons.push(lesson);
      await saveLessons(env, lessons.slice(-MAX_LESSONS));
    }
  } else {
    return false;
  }

  await repo.setStatus(id, "applied");
  return true;
}

export async function dismissSuggestion(env: Env, id: string): Promise<boolean> {
  const repo = new SuggestionsRepo(new Db(env.DB));
  const s = await repo.getById(id);
  if (!s || s.status !== "proposed") return false;
  await repo.setStatus(id, "dismissed");
  return true;
}


/**
 * Modo COPILOTO: auto-aplica las mejoras SEGURAS pendientes. Corre solo en el
 * cron nocturno cuando autonomy_level="copilot". Seguras = lecciones (vienen
 * del propio comportamiento del dueño, cap 15, reversibles desde el tab) y
 * entradas de KB SIN huecos por completar (sin "[COMPLETA"). Todo lo demás
 * espera el clic del dueño. Lo auto-aplicado queda marcado en la evidencia y
 * visible en el historial de ✦ Mejoras.
 */
export async function autoApplyPending(env: Env): Promise<{ applied: number; left: number }> {
  const db = new Db(env.DB);
  const repo = new SuggestionsRepo(db);
  const proposed = await repo.listProposed();
  let applied = 0;

  for (const s of proposed) {
    let payload: { content?: unknown } = {};
    try {
      payload = JSON.parse(s.payload);
    } catch {
      continue;
    }
    const safe =
      s.kind === "leccion" ||
      (s.kind === "kb_entry" &&
        typeof payload.content === "string" &&
        !payload.content.includes("[COMPLETA"));
    if (!safe) continue;

    const ok = await applySuggestion(env, s.id);
    if (ok) {
      applied++;
      await db.run(
        "UPDATE improvement_suggestions SET evidence = COALESCE(evidence, '') || ' · aplicada en automático (copiloto)' WHERE id = ?",
        [s.id],
      );
    }
  }

  const left = (await repo.listProposed()).length;
  if (applied > 0) console.log(`[copiloto] auto-aplicadas: ${applied}, esperando al dueño: ${left}`);
  return { applied, left };
}
