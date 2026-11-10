/** Interview preparation as the API returns it, and helpers usable on the server and in the browser. */
export type Question = { question_ar: string; question_en: string; purpose: string; requirement_key: string | null; fact_ids: string[]; listen_for_ar: string; listen_for_en: string };
export type Competency = { label_ar: string; label_en: string; requirement_key: string | null; fact_ids: string[]; criteria_ar: string; criteria_en: string; levels_ar: Record<string, string>; levels_en: Record<string, string> };
export type Fact = { id: string; kind: string; text: string };
export type Version<T> = { id: string; content: T[]; facts: Fact[]; provenance: { model_version?: string }; created_at: string } | null;
export type Preparation = { questions: Version<Question>; evaluation_form: Version<Competency>; history: { questions: number; evaluation_form: number } };

/** The form's competencies in the reader's language, as the starting list of the interviewer's feedback form. */
export function formLabels(prep: Preparation | null, locale: string) {
  return (prep?.evaluation_form?.content ?? []).map((c) => (locale === 'ar' ? c.label_ar : c.label_en));
}

