// ──────────────────────────────────────────────────────────────────────────
//  ranking.js — Sistema de ranking global via Supabase
// ──────────────────────────────────────────────────────────────────────────
//
//  COMO CONFIGURAR (passo a passo no final do arquivo / no README):
//  1. Crie conta gratuita em https://supabase.com
//  2. Crie um projeto novo
//  3. Em "SQL Editor", rode o script de criação de tabela (veja README)
//  4. Em "Project Settings > API", copie a URL e a chave "anon public"
//  5. Cole abaixo nas constantes SUPABASE_URL e SUPABASE_ANON_KEY
//
// ──────────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = "https://SEU-PROJETO.supabase.co";   // ← troque aqui
const SUPABASE_ANON_KEY = "SUA_CHAVE_ANON_PUBLIC_AQUI";        // ← troque aqui

const TABLE = "ranking";
const REST  = `${SUPABASE_URL}/rest/v1/${TABLE}`;

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};

// Verifica se as credenciais foram configuradas
const isConfigured = () =>
  !SUPABASE_URL.includes("SEU-PROJETO") && !SUPABASE_ANON_KEY.includes("SUA_CHAVE");

/**
 * Busca os 20 melhores do ranking, ordenados por tempo total.
 * Retorna [] em caso de erro ou se não configurado.
 */
export async function fetchRanking() {
  if(!isConfigured()) {
    console.warn("[ranking] Supabase não configurado — usando ranking vazio.");
    return [];
  }
  try {
    const res = await fetch(
      `${REST}?select=*&order=total_min.desc&limit=20`,
      { headers }
    );
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // normaliza os nomes de campo (snake_case do banco → camelCase do jogo)
    return data.map(r => ({
      name: r.name,
      days: r.days,
      extraTurns: r.extra_turns,
      totalMin: r.total_min,
      survived: r.survived,
      calango: r.calango,
      date: r.date,
    }));
  } catch(e) {
    console.error("[ranking] Erro ao buscar:", e);
    return [];
  }
}

/**
 * Salva uma nova entrada no ranking.
 * Retorna o ranking atualizado (top 20) ou null em caso de erro.
 */
export async function submitScore(entry) {
  if(!isConfigured()) {
    console.warn("[ranking] Supabase não configurado — score não salvo.");
    return null;
  }
  try {
    const payload = {
      name: entry.name,
      days: entry.days,
      extra_turns: entry.extraTurns,
      total_min: entry.totalMin,
      survived: entry.survived,
      calango: entry.calango,
      date: entry.date,
    };
    const res = await fetch(REST, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(payload),
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    // após salvar, retorna o ranking atualizado
    return await fetchRanking();
  } catch(e) {
    console.error("[ranking] Erro ao salvar:", e);
    return null;
  }
}
