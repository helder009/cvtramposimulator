import { useState, useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

// ── RANKING GLOBAL (Supabase) ───────────────────────────────────────────────────
// Configure suas credenciais do Supabase abaixo. Enquanto não configurar,
// o jogo usa um ranking em memória (funciona no preview do Claude, mas não
// persiste). Veja RANKING_SETUP.md para o passo a passo.
const SUPABASE_URL      = "https://tcgrfkdlwtzirlxxbzcm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3k7-4ft7b7KLTAcUfTV6dA_b5uNKna2";

const _SB_TABLE = "ranking";
const _SB_REST  = `${SUPABASE_URL}/rest/v1/${_SB_TABLE}`;
const _SB_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};
const _sbConfigured = () =>
  SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("SEU-PROJETO") &&
  SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("SUA_CHAVE");

// Fallback em memória (só dura a sessão) — usado quando o Supabase não está configurado
let _memRanking = [];

async function fetchRanking() {
  if(!_sbConfigured()){
    return [..._memRanking].sort((a,b)=>b.totalMin-a.totalMin).slice(0,500);
  }
  try {
    const res = await fetch(`${_SB_REST}?select=*&order=total_min.desc&limit=500`, { headers:_SB_HEADERS });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.map(r=>({
      name:r.name, days:r.days, extraTurns:r.extra_turns,
      totalMin:r.total_min, survived:r.survived, calango:r.calango, date:r.date,
    }));
  } catch(e){ console.error("[ranking] fetch:", e); return []; }
}

async function submitScore(entry) {
  if(!_sbConfigured()){
    _memRanking.push(entry);
    return [..._memRanking].sort((a,b)=>b.totalMin-a.totalMin).slice(0,500);
  }
  try {
    const payload = {
      name:entry.name, days:entry.days, extra_turns:entry.extraTurns,
      total_min:entry.totalMin, survived:entry.survived, calango:entry.calango, date:entry.date,
    };
    const res = await fetch(_SB_REST, {
      method:"POST",
      headers:{ ..._SB_HEADERS, "Prefer":"return=minimal" },
      body:JSON.stringify(payload),
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return await fetchRanking();
  } catch(e){ console.error("[ranking] submit:", e); return null; }
}


// ── CONSTANTES ────────────────────────────────────────────────────────────────
const TOTAL_TURNS = 38;
const TURN_MIN    = 15;
const WARN = 28; const DANGER = 10;
const clamp = v => Math.max(0, Math.min(100, v));

// ── EFEITOS SONOROS (Web Audio, sem assets) ─────────────────────────────────────
let _sfxCtx = null;
function sfx(type, vol = 0.5) {
  try {
    _sfxCtx = _sfxCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _sfxCtx, t = ctx.currentTime;
    const tone = (f0, f1, dur, delay = 0, wave = "square", v = 0.05) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = wave; o.frequency.setValueAtTime(f0, t + delay);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + delay + dur);
      g.gain.setValueAtTime(v * vol, t + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + delay); o.stop(t + delay + dur + 0.02);
    };
    if (type === "click")         tone(620, 620, 0.05, 0, "square", 0.035);
    else if (type === "action")   { tone(520, 760, 0.09, 0, "square", 0.045); }
    else if (type === "water")    { tone(320, 180, 0.12, 0, "sine", 0.07); tone(240, 150, 0.13, 0.1, "sine", 0.06); }
    else if (type === "critical") { tone(880, 880, 0.13, 0, "sawtooth", 0.05); tone(650, 650, 0.16, 0.16, "sawtooth", 0.05); }
    else if (type === "gameover") { tone(440, 100, 0.75, 0, "sawtooth", 0.06); }
    else if (type === "day")      { tone(523, 523, 0.1, 0, "square", 0.05); tone(659, 659, 0.1, 0.12, "square", 0.05); tone(784, 784, 0.18, 0.24, "square", 0.05); }
  } catch (e) { /* áudio bloqueado: segue o jogo */ }
}

// Faixas de música
const MUSIC_MAIN   = "https://res.cloudinary.com/dio7kf0tb/video/upload/v1777134013/Mofadinho_Salgado___Game_V4_ijxoys.mp3";
const MUSIC_THUTTI = "https://res.cloudinary.com/dio7kf0tb/video/upload/v1781711684/Fumo_e_Cancao_8-BitNightDrive_mkl3ed.mp3";
const MUSIC_RODA   = "https://res.cloudinary.com/dio7kf0tb/video/upload/v1783116484/Pixel_Wheel_2003_sio2wq.mp3";

const SHIFT_OPTIONS = [
  { label:"08:00", startH:8,  startM:0 },
  { label:"11:00", startH:11, startM:0 },
  { label:"13:00", startH:13, startM:0 },
];

function genLabels(startH, startM) {
  const out = [];
  let h = startH, m = startM;
  for (let i = 0; i < TOTAL_TURNS; i++) {
    out.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    m += TURN_MIN; if (m >= 60) { m -= 60; h++; }
  }
  return out;
}

function timeToTurn(hhmm, startH, startM) {
  const [h,m] = hhmm.split(":").map(Number);
  return Math.max(0, Math.floor(((h*60+m)-(startH*60+startM))/TURN_MIN));
}

// Limites de uso por ação (undefined = ilimitado)
const ACTION_LIMITS = {
  cafe_praca:2, cafe_caro:2, cafe_edit:3,
  almoco_rapido:1, mesa_quieta:1, foto_famoso:1,
  fazer_unha:1, marcar_corte:2,
  fazer_vinheta:1, fazer_logo:2, buscar_ref:2, pegar_tarefa:6,
  comer_comida:1,
  reservar_quadra:1, jogar_futebol:1,
  mostrar_helder:8, avisar_ferias:1,
  fazer_leds:1, fazer_ilustracao:2,
  padoca_dia:1, biblio_samples:4,
  trocar_ideia:6, papo_kell:2, meme_jess:2,
  janela_cor:1,
  fumar:6,
  lavar_rosto:10,
  sentar_mureta:2,
  fazer_laboral:1,
  cochilo:2,
  descargas_palavroes:1, pedir_loira:1, chamar_loira:1,
  comer_calango:2,
  voltinha_calango:2,
  esquentar_marmita:1,
  jogar_thutti:1,
  ext_pintura:1, ext_cogumelos:1, ext_voltinha_vini:1, ext_voltinha_baessa:1,
  est_extintor:4, est_kingkong:1, est_rodaroda:1, est_veraverao:1,
  sw_lanche:2, sw_esfiha:1, sw_checar:2, sw_orad:2, sw_merchan:2,
  sw_cafe:2, sw_pipoca:1, sw_assistir:1, sw_escadinha:2,
  // Jornalismo
  pacote_grafico:1, censurar_crime:4, checar_email:4, cafe_gui:2, agua_coco:1, chave_secreta:1,
  // CVT
  cvt_clipe:1, cvt_lousa:4, cvt_fofoca:1, cvt_sofa:1, cvt_imaginacao:4, cvt_passeio:1,
};

// Categorias para bloqueio global por eventos críticos
const ACTION_CAT = {
  fazer_vinheta:"criar", fazer_logo:"criar", buscar_ref:"criar", pegar_tarefa:"criar",
  comer_comida:null,
  reservar_quadra:null, jogar_futebol:null,
  mostrar_helder:"socializar", avisar_ferias:"socializar", tocar_violao:null, beber_agua_id:null,
  fazer_leds:"criar", fazer_ilustracao:"criar",
  trocar_ideia:"socializar", papo_kell:"socializar", cafe_edit:"socializar", meme_jess:"socializar",
  padoca_dia:"socializar", biblio_samples:"socializar",
  fazer_laboral:"mexer",
  subir_escada:"mexer", encher_garr:"mexer", janela_cor:null,
  lavar_rosto:"mexer", pausa_estrategica:"mexer", cochilo:null,
  descargas_palavroes:null, pedir_loira:null, chamar_loira:null,
  cafe_praca:"socializar", cafe_caro:"socializar", almoco_rapido:null, mesa_quieta:"mexer", foto_famoso:"socializar", ir_calango:"mexer",
  fazer_unha:"socializar", marcar_corte:"socializar",
  comer_calango:null, voltar_praca:"mexer", voltinha_calango:"mexer",
  voltinha:"mexer", sentar_mureta:"socializar", fumar:"mexer",
  ext_pintura:"criar", ext_cogumelos:"socializar", ext_voltinha_vini:"mexer", ext_voltinha_baessa:"mexer",
  est_extintor:null, est_kingkong:"mexer", est_rodaroda:"criar", est_veraverao:null,
  sw_lanche:"socializar", sw_esfiha:"socializar", sw_checar:"mexer", sw_orad:"criar", sw_merchan:"criar",
  sw_cafe:"socializar", sw_pipoca:"socializar", sw_assistir:"criar", sw_escadinha:"mexer",
  esquentar_marmita:"socializar",
  jogar_thutti:null,
  // Jornalismo
  pacote_grafico:"criar", censurar_crime:"criar", checar_email:"criar",
  cafe_gui:"socializar", agua_coco:null, chave_secreta:null,
  cvt_clipe:"criar", cvt_lousa:"criar", cvt_fofoca:"socializar",
  cvt_sofa:"socializar", cvt_imaginacao:"criar", cvt_passeio:"mexer",
};

// ── NPCs ──────────────────────────────────────────────────────────────────────
const NPCS = {
  helder:  { id:"helder",  name:"Hélder",     role:"Coordenador",     emoji:"👨‍💼",
    idle:"Hélder analisa a tela com aquela expressão séria de sempre.",
    chat:["Hélder: 'Preciso aprovar essa arte antes das 14h.'","Hélder: 'Tá bom. Mas o logo tá no tamanho certo?'","Hélder: 'Aprovado. Próxima.'"] },
  jess:    { id:"jess",    name:"Jess",        role:"Editoria de Arte",emoji:"😄",
    idle:"Jess está no computador, fone no ouvido, na dela.",
    chat:["Jess: 'KKKKKK esse meme é horrível, me manda no zap'","Jess: 'Você viu aquele vídeo do gato? Meu Deus.'","Jess: 'Hoje tô inspirada. Ou fingindo. Funciona igual.'"] },
  kell:    { id:"kell",    name:"Kell",        role:"Coordenadora",    emoji:"✨",
    idle:"Kell irradia aquela energia boa que só ela tem.",
    chat:["Kell: 'Você tá arrasando hoje! Olha só essa arte. 💛'","Kell: 'Bom dia meu amor! Como você tá?? Me conta tudo!'","Kell: 'Gente, que time incrível. Amo trabalhar aqui.'"] },
  calango: { id:"calango", name:"Sr. Calango", role:"Bandejão",        emoji:"🦎",
    idle:"O atendente serve o prato com uma confiança suspeita.",
    chat:["Sr. Calango: 'Feijão fresquinho! De hoje... ou ontem. Não lembro.'","Sr. Calango: 'A carne tá no ponto. Qual ponto? Não pergunte.'","Sr. Calango: 'Bom apetite! E boa sorte.' 🦎"] },
};

// ── EVENTOS CRÍTICOS ──────────────────────────────────────────────────────────
const CRITICAL_EVENTS = {
  identidade:[
    { id:"ale_urgente",   emoji:"😰", title:"Pedido Urgente do Alê!",    msg:"Alê entrou na sala em pânico com um pedido urgente. Você não consegue focar em nada.",             type:"lock", category:"criar",     turns:6 },
    { id:"servidor_caiu", emoji:"💻", title:"Servidor Caiu!",            msg:"O servidor foi pro beleléu. Todos os arquivos estão inacessíveis.",                                  type:"lock", category:"criar",     turns:6 },
  ],
  editoria:[
    { id:"alteracao",     emoji:"🚨", title:"Alteração de Última Hora!", msg:"O cliente pediu uma alteração de última hora. Você fica preso na cadeira.",                          type:"lock", category:"mexer",     turns:6 },
  ],
  corredor:[
    { id:"chato",         emoji:"😬", title:"O Chato do Corredor!",      msg:"Aquela pessoa que não para de falar te encurralou. 20 minutos depois você consegue escapar.",        type:"set_stat", stat:"socializar", value:10 },
  ],
  banheiro:[
    { id:"piriri",        emoji:"🚽", title:"PIRIRI!",                   msg:"Aquele mal-estar inoportuno te golpeou no pior momento possível.",                                    type:"set_stat", stat:"agua",        value:10 },
  ],
  praca:[
    { id:"mineiros",      emoji:"🧀", title:"Os Mineiros na Praça!",     msg:"OS MINEIROS estão vendendo queijo na praça! Barulho ensurdecedor, impossível pensar.",               type:"lock", category:"criar",     turns:4 },
  ],
  externo:[
    { id:"gatinho",       emoji:"🐱", title:"Um Gatinho!!",              msg:"Você encontrou um gatinho e ficou parado fazendo carinho por 20 minutos. Perdeu a noção do tempo.",   type:"lock", category:"socializar", turns:6 },
    { id:"cracha",        emoji:"😱", title:"PERDEU O CRACHÁ!",          msg:"Você perdeu o crachá e entrou em pânico total. Ficou rodando pelo andar procurando.",                 type:"lock", category:"criar",     turns:4, oncePer:"day" },
  ],
  jornalismo:[
    { id:"artista_morreu",emoji:"💀", title:"Artista Famoso Morreu!",    msg:"BREAKING NEWS. Todo mundo parou tudo. O andar inteiro está em colapso.",                             type:"lock_multi", categories:["socializar","mexer"], turns:8, raro:true },
    { id:"ao_vivo",       emoji:"📺", title:"Você Vazou no AO VIVO!",    msg:"A câmera te pegou no fundo do jornal comendo uma coxinha. Viralizou instantaneamente.",              type:"lock", category:"socializar", turns:20 },
  ],
  estudio:[
    { id:"caravana",      emoji:"🚌", title:"Caravana de Carapicuíba!",  msg:"Uma caravana lotada chegou pra assistir o Programa Silvio Santos. O estúdio virou um formigueiro.",  type:"lock_multi", categories:["socializar","mexer"], turns:8 },
    { id:"risada_cazalbe",emoji:"🤣", title:"Risada do Cazalbé!",        msg:"A risada do Cazalbé de Nóbrega ecoou pelo estúdio e você não consegue parar de rir.",                 type:"lock_multi", categories:["socializar","mexer"], turns:16, raro:true },
  ],
  videografismo:[
    { id:"hdvg",          emoji:"🖥️", title:"Deu pau no HDVG!",          msg:"O HDVG travou e os gráficos em tempo real morreram. Ninguém trabalha e ninguém conversa direito.",   type:"lock_multi", categories:["socializar","criar"], turns:8, chance:0.10 },
    { id:"switcher_lotado",emoji:"👥", title:"Switcher lotado!",         msg:"Muita gente dentro do switcher, é impossível se concentrar na tarefa.",                              type:"set_stat", stat:"criar", value:15, raro:true },
  ],
};

// ── FAMOSOS ───────────────────────────────────────────────────────────────────
const FAMOSOS = [
  { id:"patricia", nome:"Patricia Abravanel", emoji:"👑", prob:0.25,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780328570/_fam_patricia_g3ium0.png",
    frase:"Nossa como você é bonito(a)!",
    effects:{criar:-30, mexer:0, socializar:+60} },
  { id:"xaropinho", nome:"Xaropinho", emoji:"🎤", prob:0.10,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780328569/_fam_xaropinho_cd1goz.png",
    frase:"Rapaaaaazzz",
    effects:{criar:+100, mexer:0, socializar:+100} },
  { id:"celso", nome:"Celso Portiolli", emoji:"🎰", prob:0.25,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780328569/_fam_celso_dyror9.png",
    frase:"É hora de arriscar!",
    effects:{criar:-30, mexer:0, socializar:+60} },
  { id:"liminha", nome:"Liminha", emoji:"🎸", prob:0.40,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780328569/_fam_liminha_vpk1vr.png",
    frase:"Você Sabia que o Agnaldo Timóteo foi motorista da Ângela Maria?",
    effects:{criar:-30, mexer:0, socializar:+40} },
];

// Sorteia um famoso ponderado pelas probabilidades
function sortearFamoso() {
  const r = Math.random();
  let acc = 0;
  for(const f of FAMOSOS){
    acc += f.prob;
    if(r <= acc) return f;
  }
  return FAMOSOS[FAMOSOS.length-1];
}

// ── PERSONAGENS DA ÁREA EXTERNA ─────────────────────────────────────────────────
// Aparecem com 50% de chance/dia; sorteia entre os 3; nunca repete o do dia anterior.
// Área de clique = o próprio PNG. Cada um tem suas ações (via actionIds) e falas.
const EXT_CHARS = [
  { id:"gatica", nome:"Gatica", emoji:"🎨",
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1782160035/ext_gatica_czzawq.png",
    x:43.5, y:21.3, w:41.3, h:28.8,
    actionIds:["ext_pintura","ext_cogumelos"],
    falas:[
      { text:"Fala aí mano, obrigado pela ajuda e pelas boas vibes!", minDay:1, actionId:"ext_pintura" },
      { text:"Bora timeeeee, com esse painel vamos ganhar um Pulitzer!", minDay:1, actionId:"ext_pintura" },
      { text:"Viva Messi!", minDay:1, actionId:"ext_cogumelos" },
      { text:"Roots!!", minDay:1, actionId:"ext_cogumelos" },
      { text:"Irado!", minDay:1, actionId:"ext_cogumelos" },
    ],
  },
  { id:"vini", nome:"Vini", emoji:"🚶",
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1782160036/ext_vini_njhomi.png",
    x:29.1, y:66, w:5, h:17.6,
    actionIds:["ext_voltinha_vini"],
    falas:[
      { text:"Por cá voltinha feita, mais um dia no sistema.", minDay:1, actionId:"ext_voltinha_vini" },
    ],
  },
  { id:"baessa", nome:"Baessa", emoji:"🚶",
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1782160035/ext_baessa_esr0sm.png",
    x:70.8, y:61.6, w:4.9, h:19.8,
    actionIds:["ext_voltinha_baessa"],
    falas:[
      { text:"Você cumprimentou tanta gente que sua bateria social acabou.", minDay:1, actionId:"ext_voltinha_baessa" },
    ],
  },
];

// ── COMIDAS DA ID VISUAL ────────────────────────────────────────────────────────
// Uma comida aleatória por dia sobre a mesa; pode repetir em dias seguidos.
// Clicar abre a ação "Comer <comida>" (instantânea, 1x/dia). Área = o próprio PNG.
const COMIDA_BASE = "https://res.cloudinary.com/dio7kf0tb/image/upload/";
const COMIDAS = [
  { id:"bolo",      nome:"Bolo",                 img:COMIDA_BASE+"v1783551876/id_comida_01_bolo_bgtt4j.png",      effects:{criar:+20,socializar:+20},          fala:"Bolinho fofinho na barriguinha e bate papo." },
  { id:"balas",     nome:"Balas",                img:COMIDA_BASE+"v1783551875/id_comida_02_balas_cm2j96.png",     effects:{criar:+20},                         fala:"Cuidado com a glicemia, essas balas são um perigo." },
  { id:"panetone",  nome:"Panetone",             img:COMIDA_BASE+"v1783551876/id_comida_03_panetone_rnzabm.png", effects:{criar:+20,socializar:+20},          fala:"Comer panetones e votar qual é o melhor, um esporte de primeira." },
  { id:"queijo",    nome:"Queijo",               img:COMIDA_BASE+"v1783551878/id_comida_04_queijo_zcdw5t.png",   effects:{criar:+10,agua:-5},                 fala:"Um pouco salgado demais, preciso de água." },
  { id:"empanadas", nome:"Empanadas Argentinas", img:COMIDA_BASE+"v1783551881/id_comida_05_empanadas_sd0a5c.png",effects:{criar:+5},                          fala:"Já comi melhores, na Argentina ou no bairro da Mooca." },
  { id:"salgados",  nome:"Salgados",             img:COMIDA_BASE+"v1783551882/id_comida_06_salgados_mkhypl.png", effects:{criar:+10},                         fala:"É aniversário de alguém? Quem pediu salgados?" },
  { id:"pao",       nome:"Pãozinho caseiro",     img:COMIDA_BASE+"v1783551884/id_comida_07_pao_aiug81.png",      effects:{criar:+30,socializar:+30},          fala:"Pãozinho caseiro campeão!!" },
  { id:"funada",    nome:"Tubaína Funada",       img:COMIDA_BASE+"v1783551887/id_comida_08_funada_fyq4nf.png",   effects:{criar:+5,socializar:+5,agua:+50},   fala:"Caraca, alguém achou a raríssima Funada!", verbo:"Tomar" },
  { id:"chocolate", nome:"Chocolate",            img:COMIDA_BASE+"v1783551887/id_comida_09_chocolate_stpcp9.png",effects:{criar:+20,socializar:+10},          fala:"Vou te mostrar que é de chocolaaate, de chocolate o amor é feito, de chocolate choco choco chocolate bate o meu coração!" },
  { id:"japonesa",  nome:"Doces japoneses",      img:COMIDA_BASE+"v1783551889/id_comida_10_japonesa_lufwfq.png", effects:{criar:+10},                         fala:"Doces mais bonitos do que gostosos." },
  { id:"doritos",   nome:"Salgadinhos",          img:COMIDA_BASE+"v1783551891/id_comida_11_doritos_oizkwr.png",  effects:{mexer:-20,aguaSet:10},              fala:"Putz! Você comeu um salgadinho mofado!" },
];
const SCENE_NAV_LABELS = {
  praca:"Praça", identidade:"Id. Visual", editoria:"Editoria",
  corredor:"Corredor", banheiro:"Banheiro", calango:"Calango",
  externo:"Externa", jornalismo:"Jornalismo", cvt:"CVT",
  videografismo:"Switcher", estudio:"Estúdio", ambulatorio:"Ambulatório"
};
const SCENE_ORDER_BASE = ["praca","identidade","editoria","corredor","banheiro","calango","externo","jornalismo","videografismo","estudio","ambulatorio"];
const SCENE_ORDER_DAY2 = ["praca","identidade","editoria","corredor","banheiro","calango","externo","jornalismo","videografismo","estudio","ambulatorio"];

const SCENES = {
  praca:{
    id:"praca", name:"Praça de Alimentação", emoji:"🍽️",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908844/praca_base_bumsws.jpg",
    npcs:[],
    hotspots:[],
    clickZones:[
      { id:"zona1", label:"Padoca", emoji:"☕", x:1, y:36, w:14, h:47, type:"action", actionIds:["cafe_praca"] },
      { id:"zona2", label:"Casa do Pão de Quê?", emoji:"🧆", x:19, y:35, w:12, h:25, type:"action+dia", actionIds:["cafe_caro"], maxDay:2 },
      { id:"zona3", label:"Ir pro Calango 🦎", emoji:"🦎", x:16, y:70, w:12, h:14, type:"action", actionIds:["ir_calango"] },
      { id:"zona4", label:"Mesas", emoji:"🧘", x:39, y:52, w:33, h:26, type:"action", actionIds:["almoco_rapido","mesa_quieta"] },
      { id:"zona5", label:"Famoso", emoji:"📸", x:72.8, y:43.2, w:12.05, h:42.7, menuSide:"left", type:"famoso", actionIds:["foto_famoso"] },
      { id:"zona6", label:"TV — Silvio Santos", emoji:"📺", x:71.5, y:26.2, w:9, h:11.5,
        type:"fala",
        falas:[
          { text:"Do mundo não se leva nada. Vamos sorrir e cantar!", minDay:1 },
          { text:"Se ganha dinheiro com 10% de inspiração e 90% de transpiração", minDay:1 },
          { text:"Vai pra lá, vai pra lá!", minDay:1 },
          { text:"É você que é o ES-QUE-LE-TO?", minDay:4 },
        ],
      },
      { id:"zona7", label:"Salão de Beleza", emoji:"💅", x:88.3, y:21.5, w:8, h:23.9, menuSide:"left",
        type:"action+fala", actionIds:["fazer_unha","marcar_corte"],
        falas:[
          { text:"Fofocas em dia e autoestima renovada.", minDay:1, actionId:"fazer_unha" },
          { text:"Adorei esse esmalte cor SALGADINHO MOFADO.", minDay:1, actionId:"fazer_unha" },
          { text:"Unhas belíssimas e novos contatos feitos.", minDay:1, actionId:"fazer_unha" },
          { text:"Você precisa marcar no aplicativo", minDay:1, actionId:"marcar_corte" },
          { text:"Seu chefe sabe que você tá cortando o cabelo no meio do expediente?", minDay:1, actionId:"marcar_corte" },
          { text:"Ai, agora não dá, passa amanhã?", minDay:1, actionId:"marcar_corte" },
          { text:"Não precisa cortar o cabelo não menina, tá ótimo assim", minDay:1, actionId:"marcar_corte" },
          { text:"Se eu fosse você eu só cortaria na lua cheia...", minDay:1, actionId:"marcar_corte" },
        ],
      },
    ],
    actions:[
      {id:"cafe_praca",    label:"Tomar um café",                      emoji:"☕", time:1, effects:{criar:+5, mexer:0,   socializar:+5},  msg:"Café da praça. Fraco mas quente. Funciona."},
      {id:"cafe_caro",     label:"Tomar um café, só que mais caro",     emoji:"☕", time:1, effects:{criar:+5, mexer:0,   socializar:+5},  msg:"Café especial. Caro. Mas admita: o copo era bonito."},
      {id:"almoco_rapido", label:"Almoço rápido (cheio e barulhento)", emoji:"🍱", time:2, effects:{criar:0,  mexer:+20, socializar:+50}, availFrom:"11:30", availUntil:"15:30", msg:"Você almoçou com 200 pessoas gritando. A comida estava ok. Seus ouvidos, não."},
      {id:"mesa_quieta",   label:"Achar uma mesa pra sentar",          emoji:"🧘", time:4, effects:{criar:0,  mexer:+30, socializar:+30}, availFrom:"11:30", availUntil:"15:30", msg:"Você achou um cantinho tranquilo. Comeu devagar. Isso deveria ser mais comum."},
      {id:"foto_famoso",   label:"Tirar foto com famoso",              emoji:"📸", time:2, special:"foto_famoso", effects:{}, msg:""},
      {id:"fazer_unha",    label:"Fazer a unha",                       emoji:"💅", time:2, effects:{criar:+5, mexer:-5,  socializar:+20}, msg:"Unhas renovadas, fofocas atualizadas. Saiu de lá outra pessoa."},
      {id:"marcar_corte",  label:"Tentar marcar corte de cabelo",      emoji:"💇", time:1, effects:{criar:0,  mexer:0,   socializar:+2},  msg:"Você tentou marcar um corte. O resultado foi... burocrático."},
      {id:"ir_calango",    label:"Ir pro Calango 🦎",                  emoji:"🦎", time:0, effects:{}, navigate:"calango", msg:"Você segue em direção ao Calango. Coragem."},
    ]
  },
  identidade:{
    id:"identidade", name:"Identidade Visual", emoji:"🖥️",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908844/id-visual_base_idalhb.jpg",
    canDrink:true,
    npcs:[],
    hotspots:[],
    // Cada zona tem: falas (array, algumas com minDay), actions (ids), tipo "fala"|"action"|"drink"|"action+fala"
    clickZones:[
      {
        id:"zona1", label:"Mascote", emoji:"🟡",
        x:2, y:44, w:15, h:40,
        type:"fala",
        falas:[
          { text:"Vai lá Brasil!", minDay:1 },
          { text:"O quê você tá procurando? Não vai me sequestrar não né?", minDay:1 },
          { text:"Se me falar que eu pareço com a Betinha te arrebento!", minDay:3 },
        ],
      },
      {
        id:"zona2", label:"Hélder", emoji:"👨‍💼",
        x:20, y:42, w:19, h:26,
        type:"action+fala",
        actionIds:["mostrar_helder","avisar_ferias","reservar_quadra"],
        falas:[
          { text:"Muito bom, pode mandar bala", minDay:1, actionId:"mostrar_helder" },
          { text:"É que na verdadeeee euuu, gostaria de dizzzeerrr queee...", minDay:1, actionId:"mostrar_helder" },
          { text:"Vai viajar pra onde?", minDay:1, actionId:"avisar_ferias" },
          { text:"Não vai ficar fazendo freela nas férias hein?", minDay:1, actionId:"avisar_ferias" },
        ],
      },
      {
        id:"zona3", label:"Violão", emoji:"🎸",
        x:53, y:48, w:12, h:26,
        type:"action",
        actionIds:["tocar_violao"],
      },
      {
        id:"zona4", label:"Robô", emoji:"🤖",
        x:71.5, y:46.3, w:6.4, h:14,
        type:"fala",
        falas:[
          { text:"Instalou seus plugins BRP?", minDay:1 },
          { text:"Se precisar eu crio um script pra você", minDay:1 },
          { text:"Por favor, não me ofereça mais Monsters", minDay:3 },
        ],
      },
      {
        id:"zona5", label:"Monitores", emoji:"💻",
        x:79.2, y:45.1, w:20.8, h:17.6,
        type:"action",
        actionIds:["fazer_vinheta","fazer_logo","buscar_ref","pegar_tarefa"],
      },
      {
        id:"zona6", label:"Tentáculo", emoji:"🐙",
        x:82.7, y:3, w:9, h:32,
        type:"fala",
        falas:[
          { text:"Humm, polvos sempre representam muito bem os criativos", minDay:1 },
          { text:"Um ser misterioso está tentando perturbar a paz", minDay:3 },
        ],
      },
      {
        id:"zona7", label:"Garrafa d'água", emoji:"💧",
        x:90.8, y:70.5, w:6, h:26,
        type:"drink",
      },
      {
        id:"zonaComida", label:"Comida", emoji:"🍽️",
        x:66.7, y:51.7, w:6.3, h:8.3,
        type:"comida",
        actionIds:["comer_comida"],
      },
    ],
    actions:[
      {id:"comer_comida",   label:"Comer comida",             emoji:"🍽️", time:0,  special:"comida", effects:{}, msg:""},
      {id:"reservar_quadra",label:"Reservar Quadra",          emoji:"⚽", time:0,  availDay:5, special:"reservar_quadra", effects:{}, msg:"Reservei aqui no sistema já, agora é só pegar a chave com o segurança."},
      {id:"fazer_vinheta",  label:"Fazer uma vinheta",        emoji:"🎬", time:16, effects:{criar:+50,mexer:-50,socializar:+10}, msg:"4 horas no After Effects. Suas mãos lembram vagamente do que é descanso."},
      {id:"fazer_logo",     label:"Fazer um logo",            emoji:"🔷", time:8,  effects:{criar:+30,mexer:-30,socializar:+10}, msg:"2 horas no Illustrator. Bezier curves dominadas. Coluna destruída."},
      {id:"buscar_ref",     label:"Buscar referências",       emoji:"🔍", time:2,  effects:{criar:+10,mexer:-10,socializar:+1},  msg:"30 minutos de Pinterest e Behance. Inspiração nível máximo."},
      {id:"pegar_tarefa",   label:"Pegar tarefa da planilha", emoji:"📋", time:4,  effects:{criar:+10,mexer:-10,socializar:+10}, msg:"1 hora navegando pela planilha de chamadas. Você anotou tudo. Provavelmente."},
      {id:"mostrar_helder", label:"Mostrar arte pro Hélder",  emoji:"👁️", time:2,  effects:{criar:+10,mexer:-10,socializar:+30}, msg:"Hélder analisou por 40 segundos que pareceram 40 anos. 'Aprovado.'"},
      {id:"avisar_ferias",  label:"Avisar que marcou férias", emoji:"🏖️", time:2,  effects:{criar:0,  mexer:0,  socializar:+10}, msg:"Você avisou que marcou férias. Todo mundo fingiu que ficou feliz por você."},
      {id:"tocar_violao",   label:"Tocar violão",             emoji:"🎸", time:0,  effects:{criar:+10,mexer:+2,socializar:-40},  msg:"Você tocou três acordes. Todo mundo fez aquela cara. Missão cumprida (de irritar)."},
      {id:"beber_agua_id",  label:"Beber água",               emoji:"💧", time:0,  special:"drink", effects:{}, msg:"Você bebeu água."},
    ]
  },
  editoria:{
    id:"editoria", name:"Editoria de Arte", emoji:"🎨",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1781820477/editoria_base_2_xmrnbh.jpg",
    canDrink:true,
    npcs:[],
    hotspots:[],
    clickZones:[
      { id:"zona1", label:"Jess", emoji:"😄", x:7, y:36, w:14, h:31.7,
        type:"action+fala", actionIds:["meme_jess"],
        falas:[
          { text:"Você viu aquele vídeo do miau miau miau miau?", minDay:1 },
          { text:"Quer fazer uma tour pelo meu feed?", minDay:1 },
          { text:"Se achar o Xaropinho por aí me avisa!", minDay:3 },
        ],
      },
      { id:"zona2", label:"Monitores", emoji:"💡", x:22, y:43, w:17, h:15.9,
        type:"action", actionIds:["fazer_leds","fazer_ilustracao"],
      },
      { id:"zona8", label:"Monique", emoji:"🎧", x:23.5, y:62.4, w:12.2, h:29.9,
        type:"action+fala", actionIds:["padoca_dia","biblio_samples"],
        falas:[
          { text:"Humm, eu vou trazer o bolo Blender e você?", minDay:1, actionId:"padoca_dia" },
          { text:"Vamos fazer uma big mesa com póes e palhaçadinhas mil", minDay:1, actionId:"padoca_dia" },
          { text:"São bísnagas ou bisnágas?", minDay:1, actionId:"padoca_dia" },
          { text:"Se quiser achar alguma coisa no servidor me pergunta tá?", minDay:1, actionId:"biblio_samples" },
          { text:"Menina, o que você precisar tá aqui no Samples Monique", minDay:1, actionId:"biblio_samples" },
          { text:"Estou GAG de la GAG!", minDay:1, actionId:"biblio_samples" },
          { text:"Eu e mais 3 pessoas ouvimos Lali aqui no Brasil", minDay:1, actionId:"biblio_samples" },
          { text:"Gente, eu gosto de companhia do Calipso real!", minDay:1, actionId:"biblio_samples" },
        ],
      },
      { id:"zona3", label:"Flipchart", emoji:"📋", x:40, y:35, w:8, h:25,
        type:"action", actionIds:["trocar_ideia","fazer_laboral"],
      },
      { id:"zona4", label:"Kell", emoji:"✨", x:63, y:42, w:13, h:26, menuSide:"left",
        type:"action+fala", actionIds:["papo_kell"],
        falas:[
          { text:"Gente, que time incrível. Amo trabalhar aqui.", minDay:1 },
          { text:"Você tá arrasando hoje! Olha só essa arte.", minDay:1 },
          { text:"Conte com a gente friend, estamos todos nas trincheiras.", minDay:1 },
          { text:"E aí friend, como vai meu amigo, minha amiga?", minDay:1 },
        ],
      },
      { id:"zona5", label:"Cafeteira", emoji:"☕", x:82.4, y:43, w:6, h:14,
        type:"action", actionIds:["cafe_edit"],
      },
      { id:"zona6", label:"Garrafa d'água", emoji:"💧", x:90.8, y:3.2, w:6, h:30,
        type:"drink",
      },
      { id:"zona7", label:"Urso de pelúcia", emoji:"🐻", x:89, y:61, w:8, h:25,
        type:"fala",
        falas:[
          { text:"Oi sou o Bob, durmo enquanto eles trabalham...", minDay:1 },
          { text:"Estou com a Vitamina D baixíssima", minDay:1 },
          { text:"Eu era branco, só estou encardido", minDay:1 },
          { text:"Não sou esse tipo de urso que você tá pensando", minDay:3 },
        ],
      },
    ],
    actions:[
      {id:"fazer_leds",       label:"Fazer artes pros LEDs",        emoji:"💡", time:16, effects:{criar:+50,mexer:-50,socializar:+10}, msg:"4 horas nos painéis LED. Seus olhos são agora parte do monitor."},
      {id:"fazer_ilustracao", label:"Fazer uma ilustração",         emoji:"🖌️", time:8,  effects:{criar:+30,mexer:-30,socializar:+10}, msg:"2 horas de ilustração. A mão dói, mas a arte... quase presta."},
      {id:"trocar_ideia",     label:"Trocar ideia com o amiguinho", emoji:"💬", time:2,  effects:{criar:-10,mexer:-10, socializar:+20}, msg:"Começou sobre trabalho, virou papo sobre série. Clássico."},
      {id:"fazer_laboral",    label:"Fazer laboral improvisado",    emoji:"🧘", time:1,  availDay:2, effects:{criar:-10,mexer:+70,socializar:+30}, msg:"Laboral improvisado. Estalos, alongamentos e aquela sensação de estar vivo."},
      {id:"papo_kell",        label:"Papo com a Kell ✨",            emoji:"✨", time:2,  effects:{criar:+10,mexer:-10,socializar:+40}, msg:"Kell te elogiou e te fez sentir a pessoa mais talentosa do SBT."},
      {id:"cafe_edit",        label:"Tomar um café",                emoji:"☕", time:1,  effects:{criar:+5, mexer:0,  socializar:+5},  msg:"O café da Editoria. Sem explicação, só gratidão."},
      {id:"meme_jess",        label:"Mandar meme pra Jess",         emoji:"😂", time:2,  effects:{criar:+1, mexer:-1, socializar:+20}, msg:"Jess deu uma risada alta demais. Todo mundo olhou. Valeu cada segundo."},
      {id:"padoca_dia",       label:"Combinar o dia da padoca",     emoji:"🥐", time:1,  effects:{criar:+5, mexer:0,  socializar:+20}, msg:"O dia da padoca foi combinado. A ansiedade pelo bolo Blender começou."},
      {id:"biblio_samples",   label:"Biblioteca de Samples",        emoji:"🎧", time:1,  effects:{criar:0,  mexer:-5, socializar:+8},  msg:"A Monique te guiou pelo servidor. Samples Monique nunca falha."},
    ]
  },
  corredor:{
    id:"corredor", name:"Corredor", emoji:"🚶",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908851/corredor_base_mw0p5c.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Escada", emoji:"🪜", x:8.3, y:24.4, w:17.9, h:58.5, type:"action", actionIds:["subir_escada"] },
      { id:"zona2", label:"Porta do Banheiro", emoji:"🚻", x:35.9, y:31.3, w:13.3, h:40.2, type:"action", actionIds:["ir_banheiro"] },
      { id:"zona3", label:"Corredor", emoji:"🌃", x:55.7, y:39.5, w:7.2, h:17.3, type:"fala",
        falas:[
          { text:"Esse corredor de noite dá um pouco de medo.", minDay:1 },
          { text:"Muito fácil se perder nesse labirinto.", minDay:1 },
          { text:"O Media Center fica por ali.", minDay:1 },
          { text:"Qual a direção da saída de emergência?", minDay:1 },
        ],
      },
      { id:"zona4", label:"Bebedouro", emoji:"🚰", x:67.9, y:43.7, w:10.1, h:17.1, type:"action", actionIds:["encher_garr"] },
      { id:"zona5", label:"Janela", emoji:"🪟", x:80.1, y:26.8, w:11.5, h:65.9, type:"action", actionIds:["janela_cor"] },
    ],
    actions:[
      {id:"subir_escada", label:"Subir/descer escada",        emoji:"🪜", time:1, effects:{criar:-20,mexer:+40,socializar:0},           msg:"Ufa! Dois lances. Pode colocar no currículo: 'pratica atividade física'."},
      {id:"ir_banheiro",  label:"Ir ao banheiro",             emoji:"🚻", time:0, effects:{}, navigate:"banheiro", msg:"Você foi ao banheiro."},
      {id:"encher_garr",  label:"Encher a garrafinha d'água", emoji:"🚿", time:1, special:"encher", effects:{criar:0,mexer:+30,socializar:+30}, msg:"Garrafinha cheia. Você é responsável e consciente. Por hoje."},
      {id:"janela_cor",   label:"Olhar pela janela",          emoji:"🪟", time:2, effects:{criar:+2, mexer:+20,socializar:0},           msg:"Cinco minutos fitando o horizonte. Isso é pesquisa de referência visual."},
    ]
  },
  banheiro:{
    id:"banheiro", name:"Banheiro", emoji:"🚻",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908849/banheiro_base_ctvipp.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Pia", emoji:"🚿", x:15, y:54, w:38, h:12, type:"action", actionIds:["lavar_rosto"] },
      { id:"zona2", label:"Mensagem na parede", emoji:"✍️", x:39.9, y:30.7, w:7.8, h:14.4, type:"action+fala", actionIds:["chamar_loira"],
        falas:[
          { text:"Algum ex-funcionário deixou essa mensagem aqui...", minDay:1 },
          { text:"Alô Virgíííniaaa", minDay:4 },
        ],
      },
      { id:"zona3", label:"Cabine", emoji:"🚽", x:74.7, y:47.7, w:14.9, h:37.2, type:"action", actionIds:["pausa_estrategica","cochilo","descargas_palavroes"] },
      { id:"zonaLoira", label:"Loira do Banheiro", emoji:"👻", x:57.9, y:45.7, w:9.6, h:26.8, type:"loira",
        img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1783122991/ban_fantasma_nsko9q.png",
        actionIds:["pedir_loira"],
        falas:[
          { text:"Você me chamou três vezes... aqui estou. Vou te livrar do que te prende.", minDay:1 },
          { text:"Espelho, espelho meu... seus bloqueios acabaram.", minDay:1 },
        ],
      },
    ],
    actions:[
      {id:"lavar_rosto",       label:"Lavar o rosto",      emoji:"💦", time:1,       effects:{criar:-5, mexer:+5, socializar:-5},  msg:"Água fria no rosto. Reset mental ativado. Nova pessoa (por 10 minutos)."},
      {id:"pausa_estrategica", label:"Pausa estratégica",  emoji:"🚻", time:2,       effects:{criar:-30,mexer:+20,socializar:0},  msg:"A pausa mais honesta do dia. Aqui ninguém te interrompe. Sagrado."},
      {id:"cochilo",           label:"Arriscar cochilo 😴",emoji:"💤", time:0, special:"cochilo", effects:{},                    msg:"Você fechou os olhos 'só um segundo'..."},
      {id:"descargas_palavroes",label:"Dar 3 descargas e falar 3 palavrões", emoji:"🚽", time:1, availDay:3, special:"descargas", effects:{criar:0,mexer:0,socializar:0}, msg:"FLUSH! FLUSH! FLUSH! E três palavras impublicáveis. O banheiro estremeceu..."},
      {id:"chamar_loira",      label:"Chamar a Loira do Banheiro", emoji:"🪞", time:0, special:"chamar_loira", effects:{}, msg:"Você encarou o espelho e chamou três vezes... Uma presença surgiu atrás de você."},
      {id:"pedir_loira",       label:"Pedir ajuda à Loira", emoji:"👻", time:0, special:"loira", effects:{}, msg:"A Loira do Banheiro passou a mão sobre você. Todos os bloqueios evaporaram."},
    ]
  },
  calango:{
    id:"calango", name:"Calango 🦎", emoji:"🦎",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1781820467/calango_base_2_vhgtl7.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"← Voltar pra Praça", emoji:"↩️", x:6.3, y:67.1, w:12.4, h:30.5, type:"action", actionIds:["voltar_praca"] },
      { id:"zona2", label:"Bandeja", emoji:"🍛", x:19, y:55, w:40, h:16, type:"action", actionIds:["comer_calango"] },
      { id:"zona3", label:"Atendente", emoji:"🦎", x:60, y:38, w:9, h:25, type:"fala",
        falas:[
          { text:"Se achar um pedaço de sacola no feijão não é culpa minha.", minDay:1 },
          { text:"Já provou o strogonoff de salsicha?", minDay:1 },
          { text:"Hoje tem festival de comida verde, em minha homenagem.", minDay:1 },
        ],
      },
      { id:"zona4", label:"Micro-ondas", emoji:"🔥", x:77, y:55, w:21, h:13.7, type:"action", actionIds:["esquentar_marmita"] },
      { id:"zona5", label:"Thutti", emoji:"🎲", x:66.9, y:66.5, w:9, h:24.6, type:"action", actionIds:["jogar_thutti"] },
    ],
    actions:[
      {id:"comer_calango",     label:"Arriscar o Calango 🎲", emoji:"🦎", time:4, special:"calango_risk", effects:{}, availFrom:"11:30", msg:"Você encheu a bandeja com coragem..."},
      {id:"esquentar_marmita", label:"Esquentar a Marmita",   emoji:"🔥", time:2, effects:{criar:-10,mexer:-10,socializar:+30}, msg:"Marmita esquentada. O cheiro tomou conta. Todos te olharam — com fome."},
      {id:"jogar_thutti",      label:"Jogar Thutti Jogos 🎲",  emoji:"🎲", time:2, special:"thutti", effects:{}, msg:"Você se senta à mesa do Thutti para um desafio de cartas e dados."},
      {id:"voltar_praca",      label:"← Voltar pra Praça",    emoji:"↩️", time:0, effects:{}, navigate:"praca", msg:"Você reconsiderou. Sábio."},
    ]
  },
  externo:{
    id:"externo", name:"Área Externa", emoji:"🌳",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908849/area-externa_base_n2cnki.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Calçadão / Mureta", emoji:"🛤️", x:10.6, y:45.4, w:12.4, h:36.6, type:"action", actionIds:["voltinha","sentar_mureta","voltinha_calango"] },
      { id:"zona2", label:"Área de fumar", emoji:"🚬", x:35.5, y:40.9, w:17.9, h:21.7, type:"action+fala", actionIds:["fumar"],
        falas:[
          { text:"Fumar e respirar um pouco de ar puro. Equilíbrio é tudo.", minDay:1 },
          { text:"Esses belos paisagismos sempre me inspiram.", minDay:1 },
          { text:"Quem fuma, fuma a vida. Coma churros.", minDay:1 },
          { text:"O jardineiro é Jesus, e as arvres somos nozes.", minDay:4 },
        ],
      },
      { id:"zona3", label:"Segurança", emoji:"👮", x:47.9, y:66.1, w:5.8, h:14.6, type:"action+fala", actionIds:["jogar_futebol"],
        falas:[
          { text:"É você que tá colocando comida pros gatos aqui?", minDay:1 },
          { text:"Se eu pegar você passando o crachá pra outra pessoa, vai se ver comigo!", minDay:1 },
          { text:"Não confie totalmente na rádio peão.", minDay:1 },
          { text:"Quer a chave da quadra? Tem que fazer a reserva.", minDay:1 },
          { text:"Se o Xaropinho aparecer na praça de alimentação, liga no meu ramal!", minDay:2 },
        ],
      },
      { id:"zona4", label:"Van", emoji:"🚐", x:77.3, y:65.1, w:10.1, h:12.2, type:"fala",
        falas:[
          { text:"Xi, alguém perdeu a van...", minDay:1 },
          { text:"Uma fofoca alheia na van é sempre bem-vinda.", minDay:1 },
        ],
      },
      { id:"zona5", label:"Ir pro Calango 🦎", emoji:"🦎", x:83.7, y:20.7, w:16.3, h:22, type:"action", actionIds:["ir_calango"] },
      { id:"zonaExt", label:"Personagem", emoji:"⭐", x:43.5, y:21.3, w:9.6, h:26.8, type:"extchar" },
    ],
    actions:[
      {id:"voltinha",         label:"Dar a voltinha",         emoji:"🛤️", time:2, effects:{criar:-10,mexer:+30,socializar:+10}, msg:"Sol, vento, silêncio. Você lembrou que existe um mundo fora do After Effects."},
      {id:"sentar_mureta",    label:"Sentar na mureta",       emoji:"🧘", time:2, effects:{criar:-20,mexer:+10,socializar:+30}, msg:"Sentado na mureta, vendo a vida passar. Socializou com três pessoas aleatórias."},
      {id:"fumar",            label:"Fumar um cigarrinho",    emoji:"🚬", time:2, special:"fumar", effects:{criar:+10,mexer:+30,socializar:+30}, msg:"Cigarrinho aceso. A hidratação agradece não. Valeu o bafo?"},
      {id:"voltinha_calango", label:"Voltinha pós-Calango 🦎",emoji:"🚶", time:2, special:"voltinha_pos", effects:{criar:0,mexer:+30,socializar:+10}, msg:"A famosa voltinha! Ar fresco fez milagre. Você se sentiu vivo de novo. 🦎✅"},
      {id:"ir_calango",       label:"Ir pro Calango 🦎",      emoji:"🦎", time:0, effects:{}, navigate:"calango", msg:"Você segue em direção ao Calango. Coragem."},
      {id:"ext_pintura",      label:"Fazer uma pintura na passarela", emoji:"🎨", time:2, effects:{criar:+30,mexer:-10,socializar:+30}, msg:"Painel pintado a quatro mãos. Arte de rua dentro do SBT."},
      {id:"ext_cogumelos",    label:"Cogumelos Mágicos",      emoji:"🍄", time:0, effects:{criar:+30,mexer:-5,socializar:+5}, msg:"Cogumelos mágicos. A criatividade floresceu de formas... inesperadas."},
      {id:"ext_voltinha_vini",label:"Dar a voltinha com o Vini", emoji:"🚶", time:2, effects:{criar:0,mexer:+30,socializar:+30}, msg:"O Vini conhece todo mundo. A voltinha virou um tour social pelo SBT."},
      {id:"ext_voltinha_baessa",label:"Dar a voltinha com o Baessa", emoji:"🚶", time:2, effects:{criar:0,mexer:+30,socializar:+30}, msg:"O Baessa conhece todo mundo. Você cumprimentou meio SBT na voltinha."},
      {id:"jogar_futebol",    label:"Jogar Futebol ⚽",       emoji:"⚽", time:0, special:"futebol", effects:{}, msg:"Você pegou a chave da quadra e chamou a galera pro futebol da Criação Visual!"},
    ]
  },
  jornalismo:{
    id:"jornalismo", name:"Jornalismo", emoji:"📡",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780424251/jornalismo_base_bslb9u.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Redação", emoji:"🔥", x:2, y:38, w:17, h:17, type:"fala",
        falas:[
          { text:"Hmm, parece que a redação está pegando fogo", minDay:1 },
          { text:"O fato como ele é!", minDay:1 },
        ],
      },
      { id:"zona2", label:"Coco Mágico", emoji:"🥥", x:5.5, y:70.1, w:8.6, h:16.8, type:"coco",
        img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780424237/coco-magico_e0ovot.png",
        actionIds:["agua_coco"],
        falas:[
          { text:"Oooooi eu sou o Coco Mágico, sou rico em águas!", minDay:1 },
          { text:"HIDRATASSAAAUMMM", minDay:1 },
          { text:"Beber água é mais importante do que viver.", minDay:1 },
          { text:"Ai que delícia.", minDay:1 },
        ],
      },
      { id:"zona3", label:"Mesa de produção", emoji:"🎞️", x:22, y:49, w:20, h:23, type:"action", actionIds:["pacote_grafico"] },
      { id:"zona4", label:"Gui", emoji:"☕", x:45.1, y:35.6, w:6.8, h:32, type:"action+fala", actionIds:["cafe_gui"],
        falas:[
          { text:"Bora tomar um café?", minDay:1 },
          { text:"Não me oferece um cigarro não, por favor.", minDay:3 },
        ],
      },
      { id:"zona5", label:"Ilha de edição", emoji:"🫣", x:71.8, y:46.6, w:15.4, h:22.7, type:"action", actionIds:["censurar_crime"] },
      { id:"zona6", label:"Estante", emoji:"📚", x:71, y:32, w:21, h:15, type:"fala+chave",
        falas:[
          { text:"Alguém escondeu uns bonequinhos raros nos nichos.", minDay:1 },
          { text:"Uma bela decoração, algo me parece familiar.", minDay:1 },
          { text:"Passagens secretas costumam ficar em estantes como essa.", minDay:3 },
        ],
        actionIds:["chave_secreta"],
      },
      { id:"zona7", label:"Computador", emoji:"📧", x:88.8, y:53.9, w:10.4, h:21, type:"action", actionIds:["checar_email"] },
    ],
    actions:[
      {id:"pacote_grafico", label:"Fazer Pacote Gráfico Especial",  emoji:"🎞️", time:16, effects:{criar:+50,mexer:-50,socializar:+10}, msg:"4 horas produzindo o pacote. Grandioso. Vale o sofrimento."},
      {id:"censurar_crime", label:"Censurar imagens de crime",emoji:"🫣",  time:2,  effects:{criar:+30,mexer:-30,socializar:0},  msg:"30 minutos desfocando coisas que você não queria ter visto."},
      {id:"checar_email",   label:"Checar o e-mail",          emoji:"📧",  time:1,  effects:{criar:+20,mexer:-10,socializar:+20}, msg:"15 minutos de e-mails. Metade spam. A outra metade também."},
      {id:"cafe_gui",       label:"Tomar café com o Gui",     emoji:"☕",  time:0,  effects:{criar:+10,mexer:-1, socializar:+40}, msg:"O Gui tem histórias incríveis. E um café ainda melhor."},
      {id:"agua_coco",      label:"Água de Coco Mágica 🥥",   emoji:"🥥",  time:0,  effects:{agua:+100},                         msg:"Uma água de coco apareceu do nada. Hidratação restaurada magicamente."},
      {id:"chave_secreta",  label:"Pegar a Chave Secreta 🗝️", emoji:"🗝️", time:0, availDay:4, special:"chave_secreta", effects:{}, msg:"Você abriu uma porta que estava muito tempo trancada."},
    ]
  },
  cvt:{
    id:"cvt", name:"CVT — Novela", emoji:"📺",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780443067/cvt_base_ut79mt.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zonaSara", label:"SARA", emoji:"🤖", x:6.7, y:3.9, w:9.4, h:18.7, type:"sara",
        img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1780443067/sara_xgjsks.png",
        actionIds:["pedir_sara"],
        falas:[
          { text:"Oi eu sou S.A.R.A. (Sistema Auxiliar Racional Autônomo), precisa da minha ajuda?", minDay:1 },
          { text:"A minha voz é um pouco velha, mas estou novinha em folha...", minDay:1 },
        ],
      },
      { id:"zona1", label:"Mesa de animação", emoji:"🎬", x:8.5, y:49.8, w:19.2, h:25.6, type:"action+fala", actionIds:["cvt_clipe"],
        falas:[
          { text:"Mexe, mexe, mexe com as mããããos!!", minDay:1 },
        ],
      },
      { id:"zona2", label:"Lousa", emoji:"🖍️", x:36.9, y:39.5, w:8.6, h:19, type:"action", actionIds:["cvt_lousa"] },
      { id:"zona3", label:"Sofá", emoji:"🛋️", x:39.7, y:62.9, w:14.7, h:13.4, type:"action+fala", actionIds:["cvt_sofa","cvt_fofoca"],
        falas:[
          { text:"Pô, sofázinho macio.", minDay:1, actionId:"cvt_sofa" },
        ],
      },
      { id:"zona4", label:"Posters", emoji:"🖼️", x:59.1, y:37.2, w:13.5, h:16.6, type:"fala",
        falas:[
          { text:"Um poster irado do Megaman", minDay:1 },
          { text:"Saudosas e belíssimas ilustrações", minDay:1 },
        ],
      },
      { id:"zona5", label:"Mesa de criação", emoji:"✏️", x:60.4, y:56.3, w:16.7, h:14.1, type:"action", actionIds:["cvt_imaginacao"] },
      { id:"zona6", label:"Saída de ar", emoji:"❄️", x:77.4, y:17.1, w:7.7, h:9.3, type:"fala",
        falas:[
          { text:"Que frio da p*#!@", minDay:1 },
          { text:"Alguém coloca um papelão nessa saída de ar?", minDay:1 },
        ],
      },
      { id:"zona7", label:"Cenário da novela", emoji:"🎭", x:83, y:47.8, w:17, h:35.4, type:"action+fala", actionIds:["cvt_passeio"],
        falas:[
          { text:"Que legaaall, você relembrou de várias cenas legais das novelas, foi uma verdadeira viagem!", minDay:1 },
        ],
      },
      { id:"zona8", label:"Buraco do rato", emoji:"🐀", x:34.7, y:72.1, w:2.7, h:5.5, type:"fala",
        falas:[
          { text:"Lembra que uma vez um gato desapareceu por aqui?", minDay:1 },
          { text:"Rato meu querido rato, eu não sou assim de fino trato...", minDay:1 },
          { text:"Viu a SARA por aí?", minDay:6 },
        ],
      },
    ],
    actions:[
      {id:"cvt_clipe",      label:"Animar um Clipe Musical",       emoji:"🎬", time:16, effects:{criar:+50,mexer:-50,socializar:+10}, msg:"4 horas animando o clipe. Frame a frame. Sua alma virou keyframe."},
      {id:"cvt_lousa",      label:"Desenhar na lousa",            emoji:"🖍️", time:1,  effects:{criar:+10,mexer:-10,socializar:0},  msg:"Rabiscos na lousa. Pode ser arte, pode ser só desabafo."},
      {id:"cvt_fofoca",     label:"Fofocar sobre o fim dos tempos",emoji:"🔮", time:4,  effects:{criar:-10,mexer:-10,socializar:+50}, msg:"Teorias apocalípticas trocadas. Socialização nas alturas, esperança no chão."},
      {id:"cvt_sofa",       label:"Sentar no sofá",               emoji:"🛋️", time:4,  effects:{criar:-30,mexer:-30,socializar:+30}, msg:"O sofá te abraçou. Difícil levantar. Mas que paz."},
      {id:"cvt_imaginacao", label:"Desenhar na imaginação",       emoji:"✏️", time:2,  effects:{criar:+20,mexer:-10,socializar:0},  msg:"30 minutos imaginando. Nada no papel, tudo na cabeça. Conta como trabalho."},
      {id:"cvt_passeio",    label:"Passeio Nostálgico",           emoji:"🎭", time:8,  effects:{criar:-10,mexer:+50,socializar:+10}, msg:"2 horas passeando pelos cenários antigos. As pernas e o coração agradecem."},
      {id:"pedir_sara",     label:"Pedir ajuda pra SARA",         emoji:"🤖", time:0,  special:"sara", effects:{}, msg:"S.A.R.A. processou tudo num piscar. Todos os bloqueios foram dissolvidos."},
    ]
  },
  videografismo:{
    id:"videografismo", name:"Switcher", emoji:"🎥",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1783462471/switcher_base_2_trtzxg.jpg",
    canDrink:true,
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Garrafa d'água", emoji:"💧", x:91, y:3.4, w:6.2, h:26.3, type:"drink" },
      { id:"zona2", label:"Marquinhos", emoji:"🥪", x:85, y:56.1, w:11.8, h:35.4, menuSide:"left", type:"action+fala", actionIds:["sw_lanche","sw_esfiha"],
        falas:[
          { text:"Bom diaaaa! Hoje temos lanches na baguete a R$15,00 de: SALAME 🥪 FRANGO 🐔 CARNE LOUCA 🍖 PERNIL 🐷 ATUM 🐟", minDay:1, actionId:"sw_lanche" },
          { text:"Já comeu essa esfiha grande que parece uma mini pizza? Muito boa!", minDay:1, actionId:"sw_esfiha" },
          { text:"Qualquer coisa pode chamar, se precisar de mais alguma coisa...", minDay:1 },
        ],
      },
      { id:"zona3", label:"Switcher", emoji:"🖥️", x:10.3, y:61, w:19.6, h:14.1, type:"action", actionIds:["sw_checar"] },
      { id:"zona4", label:"ORAD", emoji:"📊", x:65.5, y:53.7, w:7.7, h:9.3, type:"action", actionIds:["sw_orad"] },
      { id:"zona5", label:"Merchan", emoji:"🏷️", x:74.9, y:53.7, w:7.7, h:9.3, type:"action", actionIds:["sw_merchan"] },
      { id:"zona6", label:"Café e pipoca", emoji:"☕", x:53.2, y:64.1, w:8.6, h:12.2, type:"action+fala", actionIds:["sw_cafe","sw_pipoca"],
        falas:[
          { text:"Cafézinho turbinado!", minDay:1, actionId:"sw_cafe" },
          { text:"Sem café não sou ninguém.", minDay:1, actionId:"sw_cafe" },
          { text:"Cheiro de pipoca no corredor todo.", minDay:1, actionId:"sw_pipoca" },
          { text:"Café com pipoca e mais algum salgado suspeito, perfeição.", minDay:1, actionId:"sw_pipoca" },
        ],
      },
      { id:"zona7", label:"Monitores", emoji:"📺", x:5.5, y:32.9, w:17.9, h:22, type:"action", actionIds:["sw_assistir","sw_escadinha"] },
      { id:"zona8", label:"Girassol", emoji:"🌻", x:61.9, y:39.3, w:4.6, h:8.8, type:"fala",
        falas:[
          { text:"Um girassol, dá vontade de cantar aquela...", minDay:1 },
          { text:"Como um girassssol amaaareloooo, amareeeloooo.", minDay:2 },
          { text:"Vento solar e estrelas do mar, um girassol da cor de seu cabelo", minDay:3 },
          { text:"Como eu sou girassol, você é meu sol!", minDay:4 },
          { text:"Quer mais uma música com girassol? Lembro daquela do Belchior...", minDay:5 },
        ],
      },
      { id:"zona9", label:"Futebol na TV", emoji:"⚽", x:79.9, y:28.9, w:10.9, h:12, type:"fala",
        falas:[
          { text:"Fut rolando na TV", minDay:1 },
          { text:"Fut rolando na TV, poderíamos marcar um jogo na quadra...", minDay:2 },
          { text:"Pede pro Hélder marcar a quadra pra gente. Ele pode no 5º dia útil.", minDay:3 },
        ],
      },
    ],
    actions:[
      {id:"sw_lanche",    label:"Pedir Lanche Natural",           emoji:"🥪", time:1, effects:{criar:+2, mexer:0,   socializar:+5},  msg:"Lanche natural na baguete pedido. O Marquinhos nunca decepciona."},
      {id:"sw_esfiha",    label:"Pedir Esfiha Grande",            emoji:"🍕", time:1, effects:{criar:+4, mexer:0,   socializar:+10}, msg:"A esfiha gigante chegou. Parece mini pizza. Comeu feliz."},
      {id:"sw_checar",    label:"Checar artes no switcher",       emoji:"🖥️", time:1, effects:{criar:-2, mexer:+8,  socializar:+5},  msg:"Você circulou pelo switcher conferindo as artes. Pernas ativas."},
      {id:"sw_orad",      label:"Programar tarjas no ORAD",       emoji:"📊", time:4, effects:{criar:+15,mexer:-5,  socializar:0},   msg:"1 hora programando tarjas no ORAD. Precisão cirúrgica nos gráficos."},
      {id:"sw_merchan",   label:"Disponibilizar artes pro Merchan",emoji:"🏷️",time:1, effects:{criar:+5, mexer:-2,  socializar:+5},  msg:"Artes de merchandising liberadas. O comercial agradece."},
      {id:"sw_cafe",      label:"Tomar café",                     emoji:"☕", time:1, effects:{criar:+5, mexer:0,   socializar:+5},  msg:"Cafezinho do switcher. Combustível audiovisual."},
      {id:"sw_pipoca",    label:"Fazer pipoca",                   emoji:"🍿", time:1, effects:{criar:0,  mexer:-5,  socializar:+10}, msg:"Pipoca feita. O cheiro convocou meio andar pra conversa."},
      {id:"sw_assistir",  label:"Assistir à gravação do programa",emoji:"📺", time:2, effects:{criar:+20,mexer:-20, socializar:+15}, msg:"Você assistiu à gravação ao vivo. Inspiração e fofoca em doses iguais."},
      {id:"sw_escadinha", label:"Descer na escadinha pro estúdio",emoji:"🪜", time:1, effects:{criar:-15,mexer:+45, socializar:0},   msg:"Descida pela escadinha até o estúdio. As pernas sentiram cada degrau."},
    ]
  },
  estudio:{
    id:"estudio", name:"Estúdio", emoji:"🎬",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1783116461/estudio_base_2_tluosa.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Ir para o Corredor", emoji:"🚶", x:3.1, y:37.8, w:10.3, h:54.9, type:"action", actionIds:["est_corredor"] },
      { id:"zona2", label:"Extintor", emoji:"🧯", x:14.9, y:56.1, w:4.2, h:14.6, type:"action+fala", actionIds:["est_extintor"],
        falas:[
          { text:"Tá pensando que é o Didi?", minDay:1 },
          { text:"Não tem fogo aqui pra apagar...", minDay:1 },
          { text:"Você criou uma neblina interessante.", minDay:1 },
          { text:"Que bela atmosfera...", minDay:1 },
        ],
      },
      { id:"zona3", label:"King Kong", emoji:"🦍", x:27.6, y:37.1, w:21.2, h:21.3, type:"action+fala", actionIds:["est_kingkong"],
        falas:[
          { text:"Seu sonho era participar de um programa de auditório, mas funcionários não podem.", minDay:1 },
          { text:"Olha o bicho vindo!", minDay:1 },
        ],
      },
      { id:"zona4", label:"Estúdio", emoji:"👻", x:42.2, y:79, w:11.5, h:16.3, type:"fala",
        falas:[
          { text:"Um estúdio assombrado é tudo o quê eu queria...", minDay:1 },
          { text:"O programa não vai começar?", minDay:1 },
          { text:"Chuveiro, chuveiro, não faz assim comigo!", minDay:1 },
          { text:"Que foi, quer dar uma bitoca no meu nariz?", minDay:1 },
          { text:"Eu já ouvi um fantasma gritando UEEEEPAAAAA aqui no estúdio!", minDay:4 },
        ],
      },
      { id:"zona5", label:"Roda a Roda", emoji:"🎡", x:80.9, y:34.4, w:15.4, h:32, type:"action", actionIds:["est_rodaroda"] },
      { id:"zonaVera", label:"Vera Verão", emoji:"👻", x:64, y:38.4, w:9.6, h:26.8, type:"vera",
        img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1783116461/est_veraverao_s96kbk.png",
        actionIds:["est_veraverao"],
        falas:[
          { text:"Êêêpaaa! Bicha não, eu sou uma quase mulher!", minDay:1 },
          { text:"Olha o respeito, que eu não sou as tuas nega!", minDay:1 },
          { text:"Êêêpaaa! Bicha não!", minDay:1 },
        ],
      },
    ],
    actions:[
      {id:"est_corredor",  label:"Ir para o Corredor",       emoji:"🚶", time:0, effects:{}, navigate:"corredor", msg:"Você deixou o estúdio e voltou ao corredor."},
      {id:"est_extintor",  label:"Usar o extintor",          emoji:"🧯", time:0, effects:{criar:+5, mexer:0,   socializar:-5}, msg:"PSSSSHHH! Neblina no estúdio. Ninguém entendeu, mas ficou artístico."},
      {id:"est_kingkong",  label:"Correr do King Kong",      emoji:"🦍", time:1, effects:{criar:0,  mexer:+30, socializar:0},  msg:"Você correu do King Kong como no programa de auditório. Adrenalina pura!"},
      {id:"est_rodaroda",  label:"Jogar Roda a Roda",        emoji:"🎡", time:2, special:"rodaroda", effects:{}, msg:"Você girou a Roda a Roda. Vamos ver no que dá!"},
      {id:"est_veraverao", label:"Fantasma da Vera Verão",   emoji:"👻", time:1, effects:{criar:+60, mexer:0,  socializar:+60}, msg:"O fantasma da Vera Verão apareceu e soltou um 'Êêêpaaa!'. Você renasceu inspirado!"},
    ]
  },
  ambulatorio:{
    id:"ambulatorio", name:"Ambulatório", emoji:"🏥",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1781822044/ambulario_base_2_mczpyw.jpg",
    npcs:[], hotspots:[],
    clickZones:[
      { id:"zona1", label:"Poltrona", emoji:"🛋️", x:1.7, y:62.9, w:17.6, h:21.7, type:"fala",
        falas:[
          { text:"Já vi o Raul Gil dormindo nessa poltrona.", minDay:1 },
          { text:"Não dá pra sentar aqui, o ambulatório está vazio.", minDay:1 },
          { text:"Alguém colocou um negócio que dá choque aqui.", minDay:4 },
        ],
      },
      { id:"zona2", label:"Esteira", emoji:"🏃", x:27.2, y:31.5, w:10.3, h:40.2, type:"action", actionIds:["amb_esteira"] },
      { id:"zona3", label:"Exame de sangue", emoji:"🩸", x:42.4, y:31.5, w:10.3, h:40.2, type:"action+fala", actionIds:["amb_sangue"],
        falas:[
          { text:"O enfermeiro mestre das agulhas tirou seu sangue tão rápido que você viu a Matrix.", minDay:1 },
        ],
      },
      { id:"zona4", label:"Soro", emoji:"💉", x:58.3, y:31.5, w:10.3, h:40.2, type:"action", actionIds:["amb_soro"] },
      { id:"zona5", label:"Enfermeira Françoise", emoji:"👩‍⚕️", x:81.9, y:46.3, w:9.6, h:13.9, menuSide:"left", type:"action+fala", actionIds:["amb_francoise"],
        falas:[
          { text:"A verdade liberta, mas antes complica bastante.", minDay:1 },
          { text:"O pior dos cinco primeiros dias da semana é sempre a segunda-feira.", minDay:1 },
          { text:"Dizem que a esperança é a última que morre. No meu caso, é a paciência.", minDay:1 },
          { text:"A vida ensina muitas lições, mas eu faltei na maioria das aulas.", minDay:1 },
          { text:"Estou fazendo a dieta da fé: como tudo o que quero e espero um milagre.", minDay:1 },
          { text:"Meu plano de carreira atual é ganhar na mega da virada.", minDay:1 },
          { text:"Eu já vi o fantasma da Vera Verão no estúdio 6!", minDay:4 },
        ],
      },
    ],
    actions:[
      {id:"amb_esteira",   label:"Correr na esteira",              emoji:"🏃", time:1, onceGame:true, effects:{mexer:+100},      msg:"Você correu na esteira como se a vida dependesse disso. Movimentação restaurada!"},
      {id:"amb_sangue",    label:"Fazer exame de sangue",          emoji:"🩸", time:1, onceGame:true, effects:{criar:+100},      msg:"Exame feito. Você viu a Matrix e voltou cheio de ideias. Criatividade restaurada!"},
      {id:"amb_soro",      label:"Tomar soro",                     emoji:"💉", time:1, onceGame:true, effects:{agua:+100},       msg:"Soro na veia. Hidratação instantânea e total. Renascido!"},
      {id:"amb_francoise", label:"Falar com a enfermeira Françoise",emoji:"👩‍⚕️",time:1, onceGame:true, effects:{socializar:+100}, msg:"A Françoise tem uma frase pra cada momento da vida. Socialização restaurada!"},
    ]
  }
};

// Cenas que liberam beber água (têm garrafa)


// ── COMPONENTES ───────────────────────────────────────────────────────────────
const StatBar = ({ label, emoji, value, color, locked, float }) => {
  const pct = clamp(value);
  const isDanger=pct<=DANGER, isWarn=pct<=WARN;
  return (
    <div style={{marginBottom:8,position:"relative"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:11,color:isDanger?"#ff4444":isWarn?"#f59e0b":"#ccc",fontFamily:"monospace",display:"flex",alignItems:"center",gap:4,animation:isDanger?"statshake .45s ease infinite":"none"}}>
          {isDanger?"⚠️":emoji} {label}{locked?<span style={{fontSize:9,color:"#ff4444"}}> 🔒</span>:null}
        </span>
        <span style={{fontSize:10,color:isDanger?"#ff6666":"#555",fontFamily:"monospace"}}>{Math.round(pct)}%</span>
      </div>
      <div style={{height:7,background:"#1a1a24",borderRadius:4,overflow:"hidden",border:`1px solid ${isDanger?"#ff444466":"#2a2a38"}`,animation:isDanger?"dangerglow 1s ease infinite":"none"}}>
        <div style={{height:"100%",width:`${pct}%`,background:isDanger?"#ff4444":isWarn?"#f59e0b":color,borderRadius:4,transition:"width 0.5s ease,background 0.3s"}}/>
      </div>
      {/* número flutuante do efeito (+X / −X) */}
      {float&&float.delta!==0&&(
        <span key={float.id} style={{
          position:"absolute",right:2,top:-6,fontSize:12,fontWeight:"bold",fontFamily:"monospace",
          color:float.delta>0?"#22c55e":"#ff5555",pointerEvents:"none",zIndex:5,
          textShadow:"0 1px 4px rgba(0,0,0,.9)",animation:"statfloat 1.4s ease forwards",
        }}>
          {float.delta>0?"+":""}{float.delta}%
        </span>
      )}
    </div>
  );
};

// Duas barras: garrafa + hidratação
const HydSection = ({ garrafa, agua, canDrinkHere, float }) => {
  const pctG = clamp(garrafa);
  const pctA = clamp(agua);
  const aIsDanger=pctA<=DANGER, aIsWarn=pctA<=WARN;
  const gEmpty = pctG<=0;
  return (
    <div style={{borderTop:"1px dashed #1a1a2a",marginTop:8,paddingTop:8}}>
      {/* Garrafa */}
      <div style={{marginBottom:7}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{fontSize:11,color:gEmpty?"#ff4444":"#60a5fa",fontFamily:"monospace",display:"flex",alignItems:"center",gap:4}}>
            {gEmpty?"🪣":"🫙"} Garrafa {gEmpty?<span style={{fontSize:9,color:"#ff4444"}}>(vazia!)</span>:null}
          </span>
          <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>{Math.round(pctG)}%</span>
        </div>
        <div style={{height:7,background:"#1a1a24",borderRadius:4,overflow:"hidden",border:`1px solid ${gEmpty?"#ff444444":"#2a2a38"}`}}>
          <div style={{height:"100%",width:`${pctG}%`,background:gEmpty?"#444":"#60a5fa",borderRadius:4,transition:"width 0.5s ease"}}/>
        </div>
      </div>
      {/* Hidratação corporal */}
      <div style={{marginBottom:4,position:"relative"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{fontSize:11,color:aIsDanger?"#ff4444":aIsWarn?"#f59e0b":"#38bdf8",fontFamily:"monospace",animation:aIsDanger?"statshake .45s ease infinite":"none"}}>
            {aIsDanger?"🚨":aIsWarn?"⚠️":"💧"} Hidratação
            {aIsWarn&&!canDrinkHere&&<span style={{fontSize:9,color:"#ff6644",marginLeft:4}}>(vá beber água!)</span>}
          </span>
          <span style={{fontSize:10,color:aIsDanger?"#ff6666":"#555",fontFamily:"monospace"}}>{Math.round(pctA)}%</span>
        </div>
        <div style={{height:7,background:"#1a1a24",borderRadius:4,overflow:"hidden",border:`1px solid ${aIsDanger?"#ff444466":"#2a2a38"}`,animation:aIsDanger?"dangerglow 1s ease infinite":"none"}}>
          <div style={{height:"100%",width:`${pctA}%`,background:aIsDanger?"#ff4444":aIsWarn?"#f59e0b":"#38bdf8",borderRadius:4,transition:"width 0.5s ease"}}/>
        </div>
        {/* número flutuante da hidratação */}
        {float&&float.delta!==0&&(
          <span key={float.id} style={{
            position:"absolute",right:2,top:-6,fontSize:12,fontWeight:"bold",fontFamily:"monospace",
            color:float.delta>0?"#22c55e":"#ff5555",pointerEvents:"none",zIndex:5,
            textShadow:"0 1px 4px rgba(0,0,0,.9)",animation:"statfloat 1.4s ease forwards",
          }}>
            {float.delta>0?"+":""}{float.delta}%
          </span>
        )}
      </div>
      <div style={{fontSize:9,color:canDrinkHere?"#0ea5e9":"#664422",marginTop:2}}>
        {canDrinkHere
          ? gEmpty?"🚫 Encha a garrafa no corredor primeiro!":"💧 Clique na garrafa para beber (−25% garrafa)"
          :"🚫 Água só na ID Visual, Editoria ou Switcher"}
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );
};

// Chat log
const ChatLog = ({ log }) => {
  const containerRef = useRef(null);
  useEffect(()=>{
    if(containerRef.current){
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  },[log]);
  return (
    <div ref={containerRef} style={{flex:1,overflowY:"auto",padding:"10px 10px 6px",background:"#d4edda",display:"flex",flexDirection:"column",gap:6}}>
      <style>{`.cbbl{animation:popIn .18s ease}@keyframes popIn{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
      {log.length===0&&<div style={{textAlign:"center",color:"#5a9e6a",fontSize:11,fontFamily:"sans-serif",marginTop:20,opacity:.7}}>Nenhuma ação ainda...<br/>Comece a jogar! 👋</div>}
      {[...log].reverse().map((l,i)=>(
        <div key={i} className="cbbl" style={{
          alignSelf:"flex-end",maxWidth:"96%",
          background:l.type==="critical"?"#ffd6d6":l.type==="warn"?"#fff3cd":l.type==="water"?"#cce8ff":l.type==="info"?"#d6ecff":"#b8d8f8",
          border:l.type==="critical"?"1px solid #ffaaaa":l.type==="warn"?"1px solid #ffc107":l.type==="info"?"1px solid #38bdf8":"1px solid #7cb9e8",
          borderRadius:"14px 14px 4px 14px",padding:"7px 11px",fontSize:10.5,
          color:l.type==="critical"?"#8b1a1a":l.type==="warn"?"#7a5500":l.type==="info"?"#075985":"#1a3a5c",
          lineHeight:1.5,fontFamily:"'Segoe UI',sans-serif",boxShadow:"0 1px 3px rgba(0,0,0,.1)"
        }}>{l.msg}</div>
      ))}
    </div>
  );
};

// Botão de ação reutilizável com contador de uso
const ActionBtn = ({ a, locked, unavail, dayLocked, exhausted, usageCount, limit, onAction }) => {
  const disabled = locked||unavail||exhausted;
  const remaining = limit !== undefined ? limit - (usageCount||0) : null;
  let tl = "instantâneo";
  if(a.special==="cochilo") tl="30min ~ 2h";
  else if(a.time>0) tl=`${a.time*15}min`;

  // Descreve efeito de boost de 100% (ex: "100% de criatividade")
  const barNames = { criar:"criatividade", mexer:"movimentação", socializar:"socialização", agua:"hidratação" };
  let boostTxt = "";
  if(a.effects){
    for(const [k,v] of Object.entries(a.effects)){
      if(v>=100 && barNames[k]){ boostTxt = `+100% de ${barNames[k]}`; break; }
    }
  }

  return (
    <button onClick={()=>!disabled&&onAction(a)}
      style={{background:disabled?"#080810":"#0e0e1c",border:`1px solid ${locked?"#ff444444":unavail?"#2a1a0033":exhausted?"#1a2a1a":"#1a1a2c"}`,borderRadius:7,padding:"7px 10px",color:disabled?"#2a2a35":"#c0c0d0",cursor:disabled?"not-allowed":"pointer",fontSize:11,textAlign:"left",display:"flex",alignItems:"center",gap:7,fontFamily:"monospace",transition:"border-color .15s,background .15s",width:"100%"}}
      onMouseEnter={e=>{ if(!disabled){e.currentTarget.style.background="#13132a";e.currentTarget.style.borderColor="#e8c840";} }}
      onMouseLeave={e=>{ if(!disabled){e.currentTarget.style.background="#0e0e1c";e.currentTarget.style.borderColor="#1a1a2c";} }}>
      <span style={{fontSize:15,opacity:disabled?.25:1,flexShrink:0}}>{a.emoji}</span>
      <span style={{flex:1,lineHeight:1.3}}>
        <span style={{display:"block"}}>
          {a.label}
          {locked&&<span style={{fontSize:8,color:"#ff4444",marginLeft:4}}>🔒</span>}
          {unavail&&!dayLocked&&<span style={{fontSize:8,color:"#7a5500",marginLeft:4}}>🕐{a.availFrom}{a.availUntil?`–${a.availUntil}`:""}</span>}
          {dayLocked&&<span style={{fontSize:8,color:"#7a5500",marginLeft:4}}>🔒 Dia {a.availDay}+</span>}
          {exhausted&&<span style={{fontSize:8,color:"#3a5a3a",marginLeft:4}}>✓ esgotado</span>}
        </span>
        {boostTxt&&<span style={{display:"block",fontSize:9,color:disabled?"#1e3a2a":"#22c55e",fontWeight:"bold"}}>{boostTxt}</span>}
        <span style={{fontSize:9,color:"#444",display:"flex",gap:6}}>
          <span>{tl}</span>
          {remaining!==null&&<span style={{color:remaining<=1?"#f59e0b":remaining===0?"#555":"#556"}}>{remaining} restante{remaining!==1?"s":""}</span>}
        </span>
      </span>
    </button>
  );
};

// Menu popup para Identidade Visual
const ActionMenu = ({ zone, actions, locks, shiftCfg, turn, usageCounts, getLimit, days, usedOnce, onAction, onClose }) => {
  // Por padrão o menu abre à direita da zona; se menuSide==="left", abre à esquerda (fora da área)
  const openLeft = zone.menuSide === "left";
  const posStyle = openLeft
    ? { right:`${Math.min(100 - zone.x + 1, 58)}%`, top:`${Math.max(5, zone.y-5)}%` }
    : { left:`${Math.min(zone.x+zone.w+1, 58)}%`,  top:`${Math.max(5, zone.y-5)}%` };
  return (
    <div onClick={e=>e.stopPropagation()} style={{
      position:"absolute",
      ...posStyle,
      background:"rgba(6,6,18,.97)",
      border:"1px solid #e8c840",
      borderRadius:10,
      padding:"10px 12px",
      minWidth:240,
      zIndex:50,
      boxShadow:"0 4px 28px rgba(0,0,0,.7)",
    }}>
      <div style={{fontSize:10,color:"#e8c840",letterSpacing:2,marginBottom:8,fontFamily:"monospace",textTransform:"uppercase"}}>{zone.emoji} {zone.label}</div>
      {actions.map(a=>{
        const cat = ACTION_CAT[a.id];
        const locked = cat && (locks[cat]||0)>0;
        const dayLocked = a.availDay && (days+1) < a.availDay;
        const unavail = dayLocked ||
          (a.availFrom && shiftCfg && turn < timeToTurn(a.availFrom, shiftCfg.startH, shiftCfg.startM)) ||
          (a.availUntil && shiftCfg && turn > timeToTurn(a.availUntil, shiftCfg.startH, shiftCfg.startM));
        const limit = getLimit(a.id);
        const usageCount = usageCounts[a.id]||0;
        const exhausted = (usedOnce&&usedOnce[a.id]) || (limit!==undefined && usageCount>=limit);
        return (
          <div key={a.id} style={{marginBottom:5}}>
            <ActionBtn a={a} locked={locked} unavail={unavail} dayLocked={dayLocked} exhausted={exhausted} usageCount={usageCount} limit={limit} onAction={onAction}/>
          </div>
        );
      })}
      <button onClick={onClose} style={{width:"100%",background:"none",border:"1px solid #2a2a3a",borderRadius:6,color:"#555",fontSize:10,fontFamily:"monospace",padding:"5px",cursor:"pointer",marginTop:4}}>✕ fechar</button>
    </div>
  );
};

// ── HELPERS DE PONTUAÇÃO (globais) ─────────────────────────────────────────────
function calcScoreGlobal(completedDays, wonTurns) {
  const totalMin = completedDays * 570 + wonTurns * 15;
  const d = Math.floor(totalMin / 570);
  const remainMin = totalMin % 570;
  const h = Math.floor(remainMin / 60);
  const m = remainMin % 60;
  return { totalMin, d, h, m };
}

function formatTimeGlobal(d, h, m) {
  const parts = [];
  if(d>0) parts.push(`${d} dia${d!==1?"s":""}`);
  if(h>0) parts.push(`${h}h`);
  if(m>0) parts.push(`${m}min`);
  return parts.length>0 ? parts.join(" e ") : "menos de 1min";
}

// ── TELA DE RANKING (reutilizável) ─────────────────────────────────────────────
const RankingScreen = ({ ranking, loading, onBack, highlightName, highlightMin, W, OUTER, INNER }) => {
  const medals = ["🥇","🥈","🥉"];
  return (
    <div style={OUTER}><div style={INNER}><div style={{...W,background:"linear-gradient(135deg,#0a0a18,#12122a,#0a0a18)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"30px 24px"}}>
      <div style={{width:"100%",maxWidth:560,display:"flex",flexDirection:"column",height:"100%"}}>

        <div style={{textAlign:"center",marginBottom:16,flexShrink:0}}>
          <div style={{fontSize:42,marginBottom:4}}>🏅</div>
          <h1 style={{color:"#e8c840",fontSize:22,fontFamily:"monospace",letterSpacing:2,margin:0,textTransform:"uppercase"}}>Ranking</h1>
          <div style={{fontSize:10,color:"#555",fontFamily:"monospace",letterSpacing:1,marginTop:4}}>Top 500 sobreviventes do SBT</div>
        </div>

        <div style={{flex:1,overflowY:"auto",background:"#06060f",border:"1px solid #1a1a2e",borderRadius:12,padding:"12px 14px",minHeight:0}}>
          {loading&&<div style={{color:"#555",fontSize:12,textAlign:"center",fontFamily:"monospace",padding:"40px 0"}}>Carregando ranking...</div>}
          {!loading&&ranking.length===0&&<div style={{color:"#444",fontSize:12,textAlign:"center",fontFamily:"monospace",padding:"40px 0"}}>Nenhum registro ainda.<br/>Seja o primeiro a aparecer aqui! 🎮</div>}
          {!loading&&ranking.map((r,i)=>{
            const s = calcScoreGlobal(r.days, r.extraTurns);
            const isMe = highlightName && r.name===highlightName && r.totalMin===highlightMin;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:isMe?"#1a1a08":(i<3?"#0f0f20":"#0b0b16"),border:`1px solid ${isMe?"#e8c840":(i<3?"#2a2a3a":"#141425")}`,borderRadius:9,marginBottom:6}}>
                <span style={{fontSize:16,flexShrink:0,width:28,textAlign:"center",fontFamily:"monospace",fontWeight:"bold",color:i<3?"#e8c840":"#555"}}>{medals[i]||`${i+1}`}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:isMe?"#e8c840":"#ddd",fontFamily:"monospace",fontWeight:"bold",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.name} {r.calango?"🦎":""}{isMe?" ←":""}
                  </div>
                  <div style={{fontSize:10,color:"#666",marginTop:2,fontFamily:"monospace"}}>
                    {formatTimeGlobal(s.d,s.h,s.m)} · {r.date}
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:13,color:r.survived?"#22c55e":"#ff6666",fontFamily:"monospace",fontWeight:"bold"}}>
                    {r.days} dia{r.days!==1?"s":""}
                  </div>
                  <div style={{fontSize:8,color:"#444",fontFamily:"monospace"}}>{r.survived?"✓ concluído":"✗ derrota"}</div>
                </div>
              </div>
            );
          })}
        </div>

        <button onClick={onBack} style={{marginTop:16,flexShrink:0,background:"#e8c840",color:"#000",border:"none",padding:"12px",borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"monospace",fontWeight:"bold",letterSpacing:2,textTransform:"uppercase"}}>
          ← Voltar à Tela Inicial
        </button>
      </div>
    </div></div></div>
  );
};

// ── INTRO ─────────────────────────────────────────────────────────────────────
const Intro = ({ onStart, onRanking }) => {
  const [nome, setNome] = useState("");
  const [shift, setShift] = useState(null);
  return (
    <div style={{width:"100%",height:"100%",background:"linear-gradient(135deg,#060610,#0d0d20,#060610)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",padding:20,boxSizing:"border-box"}}>
      <div style={{maxWidth:520,width:"100%",textAlign:"center"}}>

        {/* Logo home — 85% da largura */}
        <img
          src="https://res.cloudinary.com/dio7kf0tb/image/upload/v1783538320/logo_home_2_hl8erd.png"
          alt="Criação Visual — Sobreviva ao Expediente"
          style={{width:"85%",maxWidth:442,display:"block",margin:"0 auto 10px"}}
        />

        <p style={{color:"#666",fontSize:11.5,lineHeight:1.8,margin:"10px 0"}}>
          Mantenha <strong style={{color:"#5b8dee"}}>Criatividade</strong>, <strong style={{color:"#a855f7"}}>Socialização</strong>, <strong style={{color:"#22c55e"}}>Movimentação</strong> e <strong style={{color:"#38bdf8"}}>Hidratação</strong> acima do zero.<br/>
          <em style={{color:"#555"}}>Cuidado com os eventos críticos. E com o Calango. 🦎</em>
        </p>

        <div style={{background:"#0d0d18",border:"1px solid #2a2a3a",borderRadius:10,padding:"14px 18px",margin:"12px 0",textAlign:"left"}}>
          <label style={{fontSize:9,color:"#e8c840",letterSpacing:2,display:"block",marginBottom:7,textTransform:"uppercase"}}>Seu nome ou apelido</label>
          <input value={nome} onChange={e=>setNome(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&nome.trim()&&shift&&onStart(nome.trim(),shift)}
            placeholder="ex: Duda, Beterraba Legal, etc" maxLength={20}
            style={{width:"100%",background:"#060610",border:"1px solid #333",borderRadius:6,padding:"8px 12px",color:"#fff",fontFamily:"monospace",fontSize:13,outline:"none",boxSizing:"border-box"}}
            autoFocus/>
        </div>

        <div style={{background:"#0d0d18",border:"1px solid #2a2a3a",borderRadius:10,padding:"14px 18px",margin:"12px 0",textAlign:"left"}}>
          <div style={{fontSize:9,color:"#e8c840",letterSpacing:2,marginBottom:10,textTransform:"uppercase"}}>Horário de entrada</div>
          <div style={{display:"flex",gap:8}}>
            {SHIFT_OPTIONS.map(s=>(
              <button key={s.label} onClick={()=>setShift(s)}
                style={{flex:1,padding:"12px 6px",background:shift?.label===s.label?"#e8c840":"#0a0a14",color:shift?.label===s.label?"#000":"#555",border:`1px solid ${shift?.label===s.label?"#e8c840":"#2a2a3a"}`,borderRadius:8,cursor:"pointer",fontFamily:"monospace",fontSize:16,fontWeight:"bold",transition:"all 0.2s"}}>
                {s.label}
                <div style={{fontSize:10,marginTop:5,fontWeight:"normal",color:shift?.label===s.label?"#444":"#333"}}>9h30</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{background:"#0a0a14",border:"1px solid #1a1a2a",borderRadius:8,padding:"10px 14px",marginBottom:14,textAlign:"left",fontSize:11,color:"#555"}}>
          <div style={{color:"#e8c840",marginBottom:5,fontSize:9,letterSpacing:2,textTransform:"uppercase"}}>Como jogar</div>
          <div style={{marginBottom:2}}>🏠 Navegue pelos ambientes do SBT</div>
          <div style={{marginBottom:2}}>🖱️ Clique em objetos do cenário para ver as ações disponíveis</div>
          <div style={{marginBottom:2}}>💧 Hidratação: beba água na ID Visual ou Editoria!</div>
          <div>🔒 Eventos críticos bloqueiam ações</div>
        </div>

        {/* Botões: Bater o Ponto + Ranking */}
        <div style={{display:"flex",gap:8,alignItems:"center",justifyContent:"center"}}>
          <button onClick={()=>nome.trim()&&shift&&onStart(nome.trim(),shift)}
            disabled={!nome.trim()||!shift}
            style={{flex:1,background:(nome.trim()&&shift)?"#e8c840":"#222",color:(nome.trim()&&shift)?"#000":"#555",border:"none",padding:"11px 20px",borderRadius:8,cursor:(nome.trim()&&shift)?"pointer":"not-allowed",fontSize:13,fontFamily:"monospace",fontWeight:"bold",letterSpacing:2,textTransform:"uppercase",transition:"all 0.2s"}}>
            Bater o Ponto →
          </button>
          <button title="Ranking" onClick={onRanking}
            style={{background:"#0d0d18",border:"1px solid #2a2a3a",borderRadius:8,padding:"11px 14px",cursor:"pointer",fontSize:18,transition:"all .2s",color:"#e8c840"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#e8c840";e.currentTarget.style.background="#1a1a08";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#2a2a3a";e.currentTarget.style.background="#0d0d18";}}>
            🏅
          </button>
        </div>

      </div>
    </div>
  );
};

// ── MAIN ──────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   🎡 RODA A RODA DO SILVINHO — minigame do Estúdio (integrado)
   ═══════════════════════════════════════════════════════════════════════ */
/* ── DADOS DO JOGO ────────────────────────────────────────────────────── */
const PUZZLES = [
  { dica: "SOBREVIVÊNCIA NO SBT",  words: ["VOLTINHA", "GARRAFINHA", "PONTO"] },
  { dica: "PRAÇA DE ALIMENTAÇÃO", words: ["HIROTA", "PADOCA", "MINEIROS"] },
  { dica: "ALMOÇO",               words: ["CALANGO", "CEARÁ", "BOA MESA"] },
  { dica: "TELEVISÃO",            words: ["AUDIÊNCIA", "COMERCIAL", "NOVELA"] },
  { dica: "ESTÚDIO",              words: ["CÂMERA", "PLATEIA", "CENÁRIO"] },
  { dica: "IDENTIDADE VISUAL",    words: ["LOGOTIPO", "VINHETA", "PACOTE GRÁFICO"] },
  { dica: "JORNALISMO",           words: ["REPORTAGEM", "MANCHETE", "ÂNCORA"] },
  { dica: "AFTER EFFECTS",        words: ["COMP", "TIMELINE", "RENDER QUEUE"] },
  { dica: "FRETADO",              words: ["BARRA FUNDA", "BAIRRO", "LAPA"] },
  { dica: "MOTION",               words: ["AFTER EFFECTS", "KEYFRAMES", "CURVAS"] },
  { dica: "CLT",                  words: ["FGTS", "FÉRIAS", "VR"] },
  { dica: "PROGRAMAS",            words: ["FOFOCALIZANDO", "DOMINGO LEGAL", "THE NOITE"] },
  { dica: "CONCORRÊNCIA",         words: ["GLOBO", "CAZÉTV", "STREAMINGS"] },
  { dica: "SISTEMAS",             words: ["APDATA", "GMEDIA", "NOTION"] },
  { dica: "SILVIO SANTOS",        words: ["MAOÊ", "VEM PRA CÁ", "RITMO DE FESTA"] },
];

const SOLVE_BONUS = 1000, SOLVE_PENALTY = 500, PANEL_BONUS = 500;

const w = (v, c, text) => ({ type: "cash", value: v, label: String(v), color: c, text });
const WEDGES = [
  w(300, "#ff3d8b"), w(100, "#34d2eb"), w(450, "#f59e0b", "#1a1004"),
  w(150, "#22c55e"), w(800, "#a855f7"), w(250, "#3b82f6"),
  { type: "lose", label: "PERDEU TUDO", color: "#0c0c14" },
  w(350, "#ec4899"), w(600, "#f97316"), w(200, "#06b6d4"),
  w(1000, "#e8c840", "#1a1004"),
  { type: "lose", label: "PERDEU TUDO", color: "#0c0c14" },
  w(400, "#84cc16", "#1a1004"), w(500, "#ef4444"), w(700, "#8b5cf6"),
];

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ── FALAS DO SILVINHO ────────────────────────────────────────────────── */
const FALAS = {
  hello: n => [`Olá, ${n}! Bem-vindo ao Roda a Roda do Silvinho! Gira essa roleta!`,
               `${n}, minha gente! Hoje o painel tem três palavras. Roda a roleta!`],
  spin:  ["Roda, roda, roda!", "Olha a roleta girandooo!", "Vai com fé!", "Gira forte, gira!"],
  value: v => [`Valendo R$ ${v}! Escolha uma letra!`, `R$ ${v} na cabeça! Qual letra você quer?`],
  hit:  (n, l) => [`Tem ${n} letra${n > 1 ? "s" : ""} ${l}! Muito bem!`, `${l}! Apareceu ${n} vez${n > 1 ? "es" : ""}! Gira de novo!`],
  miss:  l => [`Ihhh... ${l} não tem, viu? Gira de novo.`, `Que pena! Não temos ${l} no painel.`],
  lose:  ["PERDEU TUUUDO! Que pena, que pena!", "Ai ai ai... a roleta zerou seu prêmio!"],
  must:  ["Faltam poucas letras! Agora é obrigatório resolver o painel!", "Chegou a hora! Resolva o painel pra faturar!"],
  wrong: ["Errooou! A plateia fez 'ohhh'... menos R$ 500.", "Não foi dessa vez! R$ 500 a menos."],
  win:   p => [`PARABÉNS! O painel acabou e você faturou R$ ${p}!`, `Que jogador! R$ ${p} no bolso!`],
};

/* ── CONVERSÃO DE PRÊMIO → RECOMPENSA NO SURVIVAL ─────────────────────── */
function rodaRewardFor(prize) {
  if (prize >= 3000) return { criar: +50, socializar: +30, mexer: +15, agua: +25, label: "PRÊMIO MÁXIMO! Você saiu do estúdio como uma celebridade." };
  if (prize >= 1500) return { criar: +20, socializar: +25, mexer: +10, agua: +15, label: "Grande prêmio! A plateia aplaudiu de pé." };
  if (prize >= 500)  return { criar: +10, socializar: +15, mexer: +5,  agua: +10, label: "Bom prêmio! Deu pra pagar o café especial." };
  return               { criar: -30, socializar: -30, mexer: 0, agua: 0, label: "Saiu no prejuízo... mas apareceu na TV!" };
}

/* ── TEXTURAS (canvas) ────────────────────────────────────────────────── */
function makeWheelTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const x = c.getContext("2d"), cx = 512, cy = 512, R = 504;
  const step = (Math.PI * 2) / WEDGES.length;
  WEDGES.forEach((wd, i) => {
    const a0 = i * step;
    x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, a0, a0 + step); x.closePath();
    x.fillStyle = wd.color; x.fill();
    x.strokeStyle = "#14082e"; x.lineWidth = 7; x.stroke();
    x.save(); x.translate(cx, cy); x.rotate(a0 + step / 2);
    x.textAlign = "right"; x.textBaseline = "middle";
    x.fillStyle = wd.text || "#fff";
    if (wd.type === "cash") { x.font = "900 64px Arial"; x.fillText(wd.label, R - 42, 0); }
    else { x.font = "900 34px Arial"; x.fillText(wd.label, R - 26, 0); }
    x.restore();
  });
  x.beginPath(); x.arc(cx, cy, 96, 0, Math.PI * 2);
  x.fillStyle = "#e8c840"; x.fill();
  x.lineWidth = 10; x.strokeStyle = "#a8861a"; x.stroke();
  x.fillStyle = "#1a1004"; x.font = "900 40px Arial";
  x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("SBT", cx, cy + 2);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}

/* cortinas roxas do estúdio */
function makeCurtainTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
  const x = c.getContext("2d");
  x.fillStyle = "#1c0a3a"; x.fillRect(0, 0, 1024, 512);
  const shades = ["#3b1366", "#2a0d4e", "#54209a", "#31115c", "#430f6e"];
  let px = 0, i = 0;
  while (px < 1024) {
    const wdt = 16 + Math.random() * 26;
    const g = x.createLinearGradient(px, 0, px + wdt, 0);
    const base = shades[i % shades.length];
    g.addColorStop(0, "#170733"); g.addColorStop(0.5, base); g.addColorStop(1, "#170733");
    x.fillStyle = g; x.fillRect(px, 0, wdt, 512);
    px += wdt; i++;
  }
  // feixes de luz magenta/azul atravessando a cortina
  x.globalCompositeOperation = "lighter";
  [["#ff3d8b", 200], ["#5a7bff", 560], ["#ff3d8b", 840]].forEach(([col, bx]) => {
    const g = x.createLinearGradient(bx, 512, bx + 90, 0);
    g.addColorStop(0, col + "00"); g.addColorStop(0.6, col + "2e"); g.addColorStop(1, col + "00");
    x.fillStyle = g;
    x.beginPath(); x.moveTo(bx, 512); x.lineTo(bx + 150, 0); x.lineTo(bx + 230, 0); x.lineTo(bx + 70, 512);
    x.closePath(); x.fill();
  });
  x.globalCompositeOperation = "source-over";
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

/* ── CENA 3D ──────────────────────────────────────────────────────────── */
/* textura do chão: glow radial no centro (palco iluminado) */
function makeFloorTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(256, 256, 30, 256, 256, 256);
  g.addColorStop(0, "#3a2a7e"); g.addColorStop(0.35, "#241a58");
  g.addColorStop(0.7, "#171040"); g.addColorStop(1, "#0d0828");
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  // anéis concêntricos sutis (piso de palco)
  x.strokeStyle = "rgba(160,140,255,.08)"; x.lineWidth = 2;
  for (let r = 60; r < 260; r += 40) { x.beginPath(); x.arc(256, 256, r, 0, Math.PI * 2); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

/* letreiro neon "RODA A RODA" para o fundo do palco */
function makeSignTexture() {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 256;
  const x = c.getContext("2d");
  x.clearRect(0, 0, 1024, 256);
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = "900 118px 'Arial Black', Arial, sans-serif";
  // halo externo
  x.shadowColor = "#ff3d8b"; x.shadowBlur = 55;
  x.fillStyle = "#ff3d8b"; x.fillText("RODA A RODA", 512, 128);
  // núcleo brilhante
  x.shadowColor = "#ffd9ea"; x.shadowBlur = 16;
  x.fillStyle = "#fff1f7"; x.fillText("RODA A RODA", 512, 128);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

function buildScene(mount, api, onSpinEndRef) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#120527");
  scene.fog = new THREE.Fog("#120527", 16, 34);

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 100);
  camera.position.set(0, 2.7, 9.8);
  camera.lookAt(0.2, 0.1, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const sun = new THREE.DirectionalLight(0xfff3d6, 0.85); sun.position.set(3, 7, 6); scene.add(sun);
  const pMag = new THREE.PointLight(0xff3d8b, 0.75, 18); pMag.position.set(-6, 4, 3); scene.add(pMag);
  const pCyn = new THREE.PointLight(0x34d2eb, 0.75, 18); pCyn.position.set(6, 4, 3); scene.add(pCyn);
  const pLed = new THREE.PointLight(0xbfeaff, 0.65, 8);  pLed.position.set(0.7, -0.4, 2.4); scene.add(pLed);
  // rim light: contorno quente vindo de trás (separa personagem/roleta do fundo)
  const rim = new THREE.DirectionalLight(0xffb86b, 0.5); rim.position.set(-2, 3, -6); scene.add(rim);

  const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
  const box = (parent, wd, h, d, color, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wd, h, d), M(color));
    m.position.set(px, py, pz); parent.add(m); return m;
  };

  /* ── palco ── */
  const FLOOR_Y = -1.5;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 40),
    new THREE.MeshBasicMaterial({ map: makeFloorTexture() }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; scene.add(floor);

  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(40, 17),
    new THREE.MeshBasicMaterial({ map: makeCurtainTexture() }));
  curtain.position.set(0, 4.5, -8.5); scene.add(curtain);

  /* letreiro neon RODA A RODA sobre a cortina */
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 2.4),
    new THREE.MeshBasicMaterial({ map: makeSignTexture(), transparent: true, depthWrite: false }));
  sign.position.set(0.4, 6.2, -8.3); scene.add(sign);

  /* partículas de brilho flutuantes (poeira de palco iluminada) */
  const sparkCount = 90;
  const sparkPos = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i++) {
    sparkPos[i * 3]     = (Math.random() - 0.5) * 22;
    sparkPos[i * 3 + 1] = FLOOR_Y + 0.3 + Math.random() * 8;
    sparkPos[i * 3 + 2] = -7 + Math.random() * 10;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffe9b0, size: 0.055, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(sparks);

  /* lâmpadas no chão ao redor do palco */
  const bulbs = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 ? "#ff3d8b" : "#e8c840" }));
    b.position.set(Math.cos(a) * 6.4, FLOOR_Y + 0.08, Math.sin(a) * 6.4);
    scene.add(b); bulbs.push(b);
  }

  /* holofotes (cones aditivos) no LADO DIREITO do cenário (longe do Silvinho) */
  const coneMat = c => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const spotL = new THREE.Mesh(new THREE.ConeGeometry(2.1, 10, 20, 1, true), coneMat("#34d2eb"));
  spotL.position.set(3.4, 3.7, -2.6); spotL.rotation.z = 0.4; scene.add(spotL);
  const spotR = new THREE.Mesh(new THREE.ConeGeometry(2.1, 10, 20, 1, true), coneMat("#ff3d8b"));
  spotR.position.set(5.6, 3.7, -2.4); spotR.rotation.z = -0.5; scene.add(spotR);

  /* ── ROLETA HORIZONTAL sobre base de LED (ref. do palco) ── */
  const WHEEL_R = 2.25;
  const WX = 0.8, WZ = 1.35, TOP_Y = FLOOR_Y + 1.04;

  // base circular iluminada (camadas de LED)
  const ledMat = c => new THREE.MeshBasicMaterial({ color: c });
  const base1 = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.55, 0.42, 40), ledMat("#7fc4ef"));
  base1.position.set(WX, FLOOR_Y + 0.21, WZ); scene.add(base1);
  const base2 = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 3.05, 0.4, 40), ledMat("#cfeeff"));
  base2.position.set(WX, FLOOR_Y + 0.6, WZ); scene.add(base2);
  const base3 = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 0.26, 40), M("#2a1a5e"));
  base3.position.set(WX, FLOOR_Y + 0.92, WZ); scene.add(base3);

  // grupo que gira em torno do eixo Y
  const spinG = new THREE.Group();
  spinG.position.set(WX, TOP_Y, WZ);
  scene.add(spinG);

  const disc = new THREE.Mesh(new THREE.CircleGeometry(WHEEL_R, 64),
    new THREE.MeshBasicMaterial({ map: makeWheelTexture() }));
  disc.rotation.x = -Math.PI / 2;          // deitada, virada pra cima
  spinG.add(disc);
  const discSide = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.14, 64), M("#3b2a78"));
  discSide.position.y = -0.08; spinG.add(discSide);

  // pinos cromados ao redor (giram junto, como no programa)
  const T = Math.PI * 2, step = T / WEDGES.length;
  const pegGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.34, 6);
  const pegMat = M("#d8dde6", { metalness: 0.7, roughness: 0.25 });
  for (let i = 0; i < WEDGES.length * 2; i++) {
    const th = i * step / 2;
    const peg = new THREE.Mesh(pegGeo, pegMat);
    peg.position.set(Math.cos(th) * (WHEEL_R - 0.07), 0.17, -Math.sin(th) * (WHEEL_R - 0.07));
    spinG.add(peg);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.16, 12),
    M("#e8c840", { metalness: 0.55, roughness: 0.3 }));
  hub.position.y = 0.08; spinG.add(hub);

  // indicador fixo na frente da roleta (lado do jogador)
  const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.46, 4), M("#ff3d3d"));
  pointer.position.set(WX, TOP_Y + 0.22, WZ + WHEEL_R + 0.22);
  pointer.rotation.x = -Math.PI / 2;       // apontando pro centro da roleta
  scene.add(pointer);

  /* ── BANCADA (pódio curvo azul, ref. do palco) ── */
  const podG = new THREE.Group(); podG.position.set(-3.0, FLOOR_Y, 0.9); podG.rotation.y = 0.3; scene.add(podG);
  const podBody = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 1.12, 14, 1, false, -0.9, 1.8), M("#b9bcc6"));
  podBody.position.y = 0.56; podG.add(podBody);
  const podTop = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 0.12, 14, 1, false, -1.0, 2.0), M("#1f5fd0"));
  podTop.position.y = 1.16; podG.add(podTop);

  /* ── SILVINHO caricato (cabeção OVAL + sorrisão feliz, ref. do boneco) ── */
  const S = new THREE.Group(); S.position.set(-3.05, FLOOR_Y, -0.15); S.rotation.y = 0.32; scene.add(S);
  const SKIN = "#f2b184", SUIT = "#15151a", HAIR = "#4a2c1a";
  const sph = (parent, r, color, px, py, pz, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), M(color));
    m.position.set(px, py, pz); m.scale.set(sx, sy, sz); parent.add(m); return m;
  };
  box(S, 0.3, 0.7, 0.32, "#101014", -0.2, 0.35, 0);                 // pernas (atrás da bancada)
  box(S, 0.3, 0.7, 0.32, "#101014", 0.2, 0.35, 0);
  const torso = box(S, 0.98, 0.92, 0.52, SUIT, 0, 1.16, 0);          // paletó preto
  box(S, 0.3, 0.4, 0.05, "#f5f5f5", 0, 1.42, 0.27);                  // camisa
  box(S, 0.13, 0.34, 0.06, "#2c2c34", 0, 1.36, 0.3);                 // gravata escura
  box(S, 0.05, 0.05, 0.05, "#777", 0.09, 1.0, 0.27);                 // botões
  box(S, 0.05, 0.05, 0.05, "#777", 0.09, 0.84, 0.27);
  // microfone de lapela no peito
  const micG = new THREE.Group(); micG.position.set(0.16, 1.5, 0.3); micG.rotation.z = -0.25; S.add(micG);
  const micB = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.16, 8), M("#9aa2ad", { metalness: 0.7 })); micG.add(micB);
  const micH = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), M("#c9d1da", { metalness: 0.7 })); micH.position.y = 0.11; micG.add(micH);

  // braços = CONES com esferas nas pontas (mãos)
  const armR = new THREE.Group(); armR.position.set(0.54, 1.52, 0.05); S.add(armR);
  const coneR = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.9, 8), M(SUIT));
  coneR.position.y = -0.45; armR.add(coneR);                          // ápice no ombro
  sph(armR, 0.15, SKIN, 0, -0.96, 0);                                 // mão
  armR.rotation.z = -0.6;
  const armL = new THREE.Group(); armL.position.set(-0.54, 1.52, 0.05); S.add(armL);
  const coneL = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.9, 8), M(SUIT));
  coneL.position.y = -0.45; armL.add(coneL);
  sph(armL, 0.15, SKIN, 0, -0.96, 0);
  armL.rotation.z = 0.6;

  // CABEÇÃO oval (esfera lowpoly facetada, bem maior que o corpo)
  const head = new THREE.Group(); head.position.set(0, 2.32, 0); S.add(head);
  sph(head, 0.7, SKIN, 0, 0, 0, 1, 1.08, 0.86);                       // crânio oval
  sph(head, 0.12, SKIN, -0.66, -0.05, 0, 0.6, 1, 0.8);                // orelhas
  sph(head, 0.12, SKIN, 0.66, -0.05, 0, 0.6, 1, 0.8);
  // TOPETE destacado: volume próprio, com a onda frontal levantada
  const quiffG = new THREE.Group(); quiffG.position.set(0, 0.58, 0.02); head.add(quiffG);
  sph(quiffG, 0.52, HAIR, 0, 0.12, -0.08, 1.18, 0.62, 1.05);          // massa principal
  const quiffFront = sph(quiffG, 0.3, HAIR, 0, 0.28, 0.42, 1.25, 1, 0.95); // onda frontal
  sph(quiffG, 0.4, HAIR, 0, -0.2, -0.44, 1.1, 0.95, 0.55);            // nuca
  // sobrancelhas levantadas (expressão feliz)
  const browL = box(head, 0.22, 0.06, 0.05, "#3a2113", -0.22, 0.32, 0.5); browL.rotation.z = 0.2;
  const browR = box(head, 0.22, 0.06, 0.05, "#3a2113", 0.22, 0.32, 0.5);  browR.rotation.z = -0.2;
  // olhos sorridentes
  sph(head, 0.1, "#fff", -0.22, 0.17, 0.52, 1, 1.1, 0.5);
  sph(head, 0.1, "#fff", 0.22, 0.17, 0.52, 1, 1.1, 0.5);
  sph(head, 0.045, "#231a12", -0.2, 0.16, 0.59);
  sph(head, 0.045, "#231a12", 0.24, 0.16, 0.59);
  // narigão redondo
  sph(head, 0.16, "#e3a070", 0, -0.04, 0.62, 1, 1.15, 1);
  // SORRISÃO FELIZ: boca aberta em meia-lua com dentões e língua
  const mouthG = new THREE.Group(); mouthG.position.set(0, -0.2, 0.57); head.add(mouthG);
  const mouthBg = new THREE.Mesh(new THREE.CircleGeometry(0.38, 16, Math.PI, Math.PI), M("#7a2c2c"));
  mouthG.add(mouthBg);                                                 // meia-lua pra baixo = risada
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.17, 0.05), M("#ffffff"));
  teeth.position.set(0, -0.082, 0.02); mouthG.add(teeth);              // dentões
  const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.15, 10, Math.PI, Math.PI), M("#c2554f"));
  tongue.position.set(0, -0.17, 0.01); mouthG.add(tongue);             // língua

  // Silvinho 100% chapado: troca todos os materiais do grupo S por MeshBasicMaterial
  S.traverse(o => {
    if (o.isMesh && o.material && o.material.color) {
      const flat = new THREE.MeshBasicMaterial({ color: o.material.color.clone() });
      o.material.dispose(); o.material = flat;
    }
  });

  /* ── ESTADO DA ANIMAÇÃO ── */
  const POINTER_A = -Math.PI / 2;  // ângulo da textura sob o indicador (frente)
  const idxAt = rot => Math.floor((((POINTER_A - rot) % T) + T) % T / step) % WEDGES.length;
  let spin = null, lastIdx = idxAt(0), talkUntil = 0, confetti = [];
  let raf = 0, t0 = performance.now(), audioCtx = null;

  const tick = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "square"; o.frequency.value = 760;
      g.gain.setValueAtTime(0.05, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.06);
    } catch (e) { /* áudio bloqueado: segue o jogo */ }
  };
  const jingle = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784, 1047].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const t = audioCtx.currentTime + i * 0.13;
        g.gain.setValueAtTime(0.001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t); o.stop(t + 0.35);
      });
    } catch (e) {}
  };

  /* API exposta pro React */
  api.spin = () => {
    if (spin) return;
    const extra = (3.6 + Math.random() * 2.6) * T;
    spin = { from: spinG.rotation.y, to: spinG.rotation.y + extra, t0: performance.now(), dur: 4300 };
  };
  api.talk = (ms = 2400) => { talkUntil = performance.now() + ms; };
  api.confetti = () => {
    jingle();
    const cols = ["#e8c840", "#ff3d8b", "#34d2eb", "#22c55e", "#a855f7", "#ffffff"];
    for (let i = 0; i < 150; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.14),
        new THREE.MeshBasicMaterial({ color: pick(cols), side: THREE.DoubleSide }));
      m.position.set((Math.random() - 0.5) * 9, 4 + Math.random() * 3, (Math.random() - 0.5) * 4);
      m.userData = { vy: 0.7 + Math.random() * 1.3, vr: (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 0.5 };
      scene.add(m); confetti.push(m);
    }
  };

  /* resize */
  const resize = () => {
    const wpx = mount.clientWidth || 1, hpx = mount.clientHeight || 1;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(mount);

  /* loop */
  let prev = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
    const t = (now - t0) / 1000;

    if (spin) {
      const p = Math.min((now - spin.t0) / spin.dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      spinG.rotation.y = spin.from + (spin.to - spin.from) * e;
      const i = idxAt(spinG.rotation.y);
      if (i !== lastIdx) { tick(); lastIdx = i; }
      if (p >= 1) {
        const finalIdx = idxAt(spinG.rotation.y); spin = null;
        onSpinEndRef.current && onSpinEndRef.current(WEDGES[finalIdx]);
      }
    }

    // Silvinho vivo
    S.position.y = FLOOR_Y + Math.sin(t * 2.1) * 0.035;
    head.rotation.z = Math.sin(t * 1.4) * 0.06;
    head.rotation.y = Math.sin(t * 0.8) * 0.08;
    torso.rotation.y = Math.sin(t * 0.9) * 0.04;
    const talking = now < talkUntil;
    armR.rotation.z = talking ? -0.6 - Math.abs(Math.sin(t * 9)) * 0.5 : -0.6 + Math.sin(t * 1.7) * 0.05;
    armL.rotation.z = talking ?  0.6 + Math.abs(Math.cos(t * 9)) * 0.5 :  0.6 - Math.sin(t * 1.7) * 0.05;
    mouthG.scale.y  = talking ? 1.35 + Math.sin(t * 22) * 0.35 : 1;     // risada abre pra baixo
    teeth.scale.y   = talking ? 0.8 : 1;
    quiffFront.rotation.x = Math.sin(t * 2.3) * 0.1;                    // topete balança

    spotL.rotation.z = 0.4 + Math.sin(t * 0.7) * 0.16;
    spotR.rotation.z = -0.5 + Math.cos(t * 0.6) * 0.16;
    bulbs.forEach((b, i) => { const s = 0.8 + Math.abs(Math.sin(t * 3 + i)) * 0.7; b.scale.setScalar(s); });
    base2.material.color.setHSL(0.55, 0.55, 0.82 + Math.sin(t * 2.4) * 0.08); // respiro do LED

    // partículas flutuam devagar; letreiro neon respira
    sparks.rotation.y = t * 0.02;
    sparks.position.y = Math.sin(t * 0.5) * 0.15;
    sign.material.opacity = 0.88 + Math.sin(t * 2.1) * 0.12;

    for (let i = confetti.length - 1; i >= 0; i--) {
      const m = confetti[i];
      m.position.y -= m.userData.vy * dt;
      m.position.x += m.userData.vx * dt;
      m.rotation.x += m.userData.vr * dt; m.rotation.y += m.userData.vr * 0.6 * dt;
      if (m.position.y < FLOOR_Y - 0.2) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); confetti.splice(i, 1); }
    }

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
    renderer.dispose();
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}

/* ═══════════════════════════ COMPONENTE ═══════════════════════════════ */
function RodaARoda({ playerName = "Você", onClose, onReward }) {
  const mountRef = useRef(null);
  const apiRef = useRef({});
  const onSpinEndRef = useRef(null);

  const [puzzle]   = useState(() => pick(PUZZLES));
  const [phase, setPhase]       = useState("intro"); // intro|spin|spinning|pick|solve|end
  const [revealed, setRevealed] = useState(() => new Set());
  const [used, setUsed]         = useState(() => new Set());
  const [prize, setPrize]       = useState(0);
  const [curValue, setCurValue] = useState(0);
  const [bubble, setBubble]     = useState("");
  const [solveText, setSolveText] = useState("");
  const [lastLetter, setLastLetter] = useState("");
  const [spinResult, setSpinResult] = useState(null); // {value} | {lose:true}
  const [endInfo, setEndInfo]   = useState(null);
  const [redeemed, setRedeemed] = useState(false);

  const allLetters = puzzle.words.map(norm).join("").replace(/[^A-Z]/g, "");
  const FORCE_SOLVE_AT = 4; // faltando <= 4 letras, é obrigatório resolver
  const remainingFor = (rev) => allLetters.split("").filter(c => !rev.has(c)).length;

  const say = useCallback((text, ms) => {
    setBubble(text);
    apiRef.current.talk && apiRef.current.talk(ms || Math.max(1800, text.length * 55));
  }, []);

  /* monta a cena 3D */
  useEffect(() => {
    if (!mountRef.current) return;
    const dispose = buildScene(mountRef.current, apiRef.current, onSpinEndRef);
    return dispose;
  }, []);

  const finishWin = useCallback((bonus, bonusLabel) => {
    setRevealed(new Set(allLetters.split("")));
    setPrize(p => {
      const total = p + bonus;
      say(pick(FALAS.win(total)));
      return total;
    });
    setEndInfo({ bonusLabel });
    setPhase("end");
    apiRef.current.confetti && apiRef.current.confetti();
  }, [allLetters, say]);

  /* resultado da roleta */
  const handleWedge = useCallback((wedge) => {
    if (wedge.type === "cash") {
      setSpinResult({ value: wedge.value });
      setCurValue(wedge.value);
      setPhase("pick");
      say(pick(FALAS.value(wedge.value)));
    } else { // lose
      setSpinResult({ lose: true });
      setPrize(0);
      setPhase("spin");
      say(pick(FALAS.lose));
    }
  }, [say]);
  useEffect(() => { onSpinEndRef.current = handleWedge; }, [handleWedge]);

  const startSpin = () => {
    if (phase !== "spin") return;
    setSpinResult(null);
    setPhase("spinning");
    say(pick(FALAS.spin));
    apiRef.current.spin && apiRef.current.spin();
  };

  /* SEM distinção vogal/consoante: qualquer letra vale */
  const pickLetter = (L) => {
    if (phase !== "pick" || used.has(L)) return;
    const nu = new Set(used); nu.add(L); setUsed(nu);
    setLastLetter(L);

    const count = allLetters.split("").filter(c => c === L).length;
    if (count > 0) {
      const nr = new Set(revealed); nr.add(L); setRevealed(nr);
      setPrize(p => p + curValue * count);
      const remaining = remainingFor(nr);
      if (remaining === 0) { finishWin(PANEL_BONUS, `+R$ ${PANEL_BONUS} por completar o painel`); return; }
      if (remaining <= FORCE_SOLVE_AT) {        // obrigatório resolver
        setSpinResult(null);
        say(pick(FALAS.must));
        setPhase("mustsolve");
        return;
      }
      say(pick(FALAS.hit(count, L)));
    } else {
      say(pick(FALAS.miss(L)));
    }
    setPhase("spin");
  };

  const submitSolve = () => {
    const target = puzzle.words.map(norm).join(" ");
    const guess  = norm(solveText).replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
    setSolveText("");
    if (guess === target) {
      finishWin(SOLVE_BONUS, `+R$ ${SOLVE_BONUS} de bônus por resolver`);
    } else {
      setPrize(p => Math.max(0, p - SOLVE_PENALTY));
      say(pick(FALAS.wrong));
      setPhase(remainingFor(revealed) <= FORCE_SOLVE_AT ? "mustsolve" : "spin");
    }
  };

  const reward = rodaRewardFor(prize);

  /* grade do painel — largura automática (maior palavra + 2), frases quebradas em linhas, centralizado */
  const panelLines = puzzle.words.flatMap(wd => wd.split(" "));
  const cols = Math.max(...panelLines.map(wd => wd.length)) + 2;
  const padRow = Array(cols).fill(null);
  const gridRows = [
    padRow,
    ...panelLines.map(word => {
      const letters = word.split("");
      const pad = cols - letters.length, left = Math.floor(pad / 2);
      return [...Array(left).fill(null), ...letters, ...Array(pad - left).fill(null)]; // centralizado
    }),
    padRow,
  ];

  return (
    <div className="rr-root">
      <style>{RR_CSS}</style>

      {/* cena 3D */}
      <div ref={mountRef} className="rr-canvas" />

      {/* topo: logo dourado + prêmio + fechar */}
      <div className="rr-top">
        <div className="rr-logo">
          <span className="l1">RODA</span>
          <span className="l2">A&nbsp;RODA</span>
        </div>
        <div className="rr-right">
          <div className="rr-prize"><span>PRÊMIO</span>R$ {prize}</div>
        </div>
      </div>

      {/* PAINEL DE LETRAS (ref. do programa) */}
      <div className="rr-panel">
        <div className="rr-board">
          <div className="rr-board-in">
            {gridRows.map((row, ri) => (
              <div className="rr-row-tiles" key={ri}>
                {row.map((ch, ci) => {
                  if (ch === null) return <div key={ci} className="rr-cell" />;
                  const isRev = revealed.has(norm(ch));
                  return (
                    <div key={ci} className={`rr-cell slot ${isRev ? "rev" : ""}`}>
                      {isRev ? ch : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="rr-dica-banner"><span>DICA</span>{puzzle.dica}</div>
        {lastLetter && <div className="rr-last">{lastLetter}</div>}
      </div>

      {/* balão do Silvinho */}
      {bubble && phase !== "intro" && (
        <div className="rr-bubble" key={bubble}>
          <b>SILVINHO</b>
          <div>{bubble}</div>
        </div>
      )}

      {/* RESULTADO DA ROLETA — popup à direita, sobre a roleta */}
      {spinResult && (phase === "pick" || phase === "spin") && (
        <div className={`rr-result ${spinResult.lose ? "lose" : ""}`} key={spinResult.lose ? "lose" : spinResult.value}>
          {spinResult.lose ? (
            <>
              <span className="rr-result-cap">A ROLETA PAROU EM</span>
              <strong>PERDEU TUDO</strong>
            </>
          ) : (
            <>
              <span className="rr-result-cap">VALENDO</span>
              <strong>R$ {spinResult.value}</strong>
              <small>por letra no painel</small>
            </>
          )}
        </div>
      )}

      {/* valendo (rodapé discreto) */}
      {(phase === "pick") && <div className="rr-valendo">ESCOLHA UMA LETRA</div>}

      {/* controles + teclado */}
      {phase !== "intro" && phase !== "end" && phase !== "solve" && phase !== "mustsolve" && (
        <div className="rr-bottom">
          <div className="rr-actions">
            <button className="rr-btn gold" disabled={phase !== "spin"} onClick={startSpin}>
              🎡 GIRAR
            </button>
            <button className="rr-btn pink" disabled={phase !== "spin"} onClick={() => setPhase("solve")}>
              💡 RESOLVER
            </button>
          </div>
          <div className="rr-kb">
            {LETTERS.map(L => (
              <button key={L}
                className={`rr-key ${used.has(L) ? "used" : ""}`}
                disabled={phase !== "pick" || used.has(L)}
                onClick={() => pickLetter(L)}>
                {L}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* INTRO */}
      {phase === "intro" && (
        <div className="rr-overlay">
          <div className="rr-card">
            <div className="rr-logo intro">
              <span className="l1">RODA</span>
              <span className="l2">A&nbsp;RODA</span>
            </div>
            <p className="rr-rules">
              Gire a roleta e escolha <b>qualquer letra</b> — cada ocorrência no painel
              vale o valor sorteado.<br />
              Resolver o painel certo dá <b>+R$ {SOLVE_BONUS}</b>; errado, <b>−R$ {SOLVE_PENALTY}</b>.<br />
              Cuidado com o <b>PERDEU TUDO</b>!
            </p>
            <button className="rr-btn gold big" onClick={() => { setPhase("spin"); say(pick(FALAS.hello(playerName))); }}>
              ▶ COMEÇAR
            </button>
          </div>
        </div>
      )}

      {/* RESOLVER (voluntário ou obrigatório) — com cópia do painel e letras usadas */}
      {(phase === "solve" || phase === "mustsolve") && (
        <div className="rr-overlay">
          <div className="rr-card solve-card">
            <h3>💡 RESOLVER O PAINEL</h3>
            {phase === "mustsolve" && (
              <div className="rr-bonus warn">⚠ Faltam {FORCE_SOLVE_AT} letras ou menos — é obrigatório resolver!</div>
            )}

            {/* cópia do painel preenchido até agora */}
            <div className="rr-board mini">
              <div className="rr-board-in">
                {gridRows.map((row, ri) => (
                  <div className="rr-row-tiles" key={ri}>
                    {row.map((ch, ci) => {
                      if (ch === null) return <div key={ci} className="rr-cell" />;
                      const isRev = revealed.has(norm(ch));
                      return <div key={ci} className={`rr-cell slot ${isRev ? "rev" : ""}`}>{isRev ? ch : ""}</div>;
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="rr-dica-banner mini"><span>DICA</span>{puzzle.dica}</div>

            {/* letras já chamadas que NÃO estão no painel (queimadas) */}
            <div className="rr-burned">
              <span>LETRAS QUE NÃO TÊM:</span>
              <div className="rr-burned-list">
                {LETTERS.filter(L => used.has(L) && !allLetters.includes(L)).map(L => (
                  <b key={L}>{L}</b>
                ))}
                {LETTERS.filter(L => used.has(L) && !allLetters.includes(L)).length === 0 && <i>nenhuma ainda</i>}
              </div>
            </div>

            <p className="rr-rules tight">Digite as <b>três palavras na ordem</b>, separadas por espaço.<br />
              Acertou: <b>+R$ {SOLVE_BONUS}</b> · Errou: <b>−R$ {SOLVE_PENALTY}</b></p>
            <input
              className="rr-input" autoFocus value={solveText}
              placeholder={puzzle.words.map(wd => "•".repeat(wd.length)).join("  ")}
              onChange={e => setSolveText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitSolve(); }}
            />
            <div className="rr-row">
              {phase === "solve" && (
                <button className="rr-btn ghost" onClick={() => setPhase("spin")}>CANCELAR</button>
              )}
              <button className="rr-btn gold" disabled={!solveText.trim()} onClick={submitSolve}>CONFIRMAR</button>
            </div>
          </div>
        </div>
      )}

      {/* FIM */}
      {phase === "end" && (
        <div className="rr-overlay">
          <div className="rr-card">
            <div className="rr-card-emoji">🏆</div>
            <h3>FIM DE JOGO!</h3>
            {endInfo?.bonusLabel && <div className="rr-bonus">{endInfo.bonusLabel}</div>}
            <div className="rr-final">R$ {prize}</div>
            <p className="rr-rules">{reward.label}</p>
            <div className="rr-reward">
              {reward.criar !== 0 && <span>🎨 Criar +{reward.criar}</span>}
              {reward.socializar !== 0 && <span>💬 Social +{reward.socializar}</span>}
              {reward.mexer !== 0 && <span>🏃 Mexer +{reward.mexer}</span>}
              {reward.agua !== 0 && <span>💧 Água +{reward.agua}</span>}
            </div>
            <button className="rr-btn gold big" disabled={redeemed}
              onClick={() => { setRedeemed(true); onReward && onReward(prize); onClose && onClose(); }}>
              🎁 RESGATAR E VOLTAR AO EXPEDIENTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
/* ── ESTILO (prefixo rr- pra não colidir com o SBT Survival) ──────────── */
const RR_CSS = `
.rr-root{position:absolute;top:10%;left:10%;width:80%;height:80%;z-index:998;overflow:hidden;
  background:#120527;font-family:monospace;color:#fff;user-select:none;
  border:3px solid #fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.7);}
.rr-canvas{position:absolute;inset:0;}
.rr-top{position:absolute;top:0;left:0;right:0;display:flex;align-items:flex-start;
  justify-content:space-between;padding:10px 14px;gap:10px;z-index:5;pointer-events:none;}
.rr-top button{pointer-events:auto;}

/* LOGO dourado 3D (ref. do logotipo) */
.rr-logo{transform:rotate(-4deg);line-height:.9;font-family:'Arial Black',Arial,sans-serif;}
.rr-logo .l1,.rr-logo .l2{display:block;font-weight:900;font-style:italic;letter-spacing:1px;
  background:linear-gradient(180deg,#fff3c4 0%,#ffd23d 42%,#ff9d1f 78%,#e8741a 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  -webkit-text-stroke:1px #173086;
  filter:drop-shadow(2px 3px 0 #14246e) drop-shadow(0 0 14px rgba(0,0,0,.55));}
.rr-logo .l1{font-size:24px;}
.rr-logo .l2{font-size:27px;margin-top:-3px;}
.rr-logo em{display:block;font-style:normal;font-family:monospace;font-size:9px;
  letter-spacing:3px;color:#ff8fc0;margin-top:3px;text-shadow:0 1px 0 #000;}
.rr-logo.intro{transform:rotate(-3deg) scale(1.5);margin:6px 0 22px;display:inline-block;}

.rr-right{display:flex;gap:8px;align-items:flex-start;}
.rr-prize{background:linear-gradient(160deg,#241250ee,#140933ee);border:2px solid #e8c840;border-radius:12px;padding:6px 14px;
  font-size:16px;font-weight:bold;color:#ffe08a;text-align:right;
  box-shadow:0 0 22px #e8c84040,inset 0 1px 0 rgba(255,255,255,.1);text-shadow:0 0 10px rgba(232,200,64,.5);}
.rr-prize span{display:block;font-size:8px;letter-spacing:3px;color:#a8861a;}
.rr-x{background:#2a0c0c;border:1px solid #ff4444;color:#ff8888;border-radius:8px;width:30px;height:30px;
  cursor:pointer;font-size:13px;font-family:monospace;}
.rr-x:hover{background:#3d0f0f;}

/* PAINEL DE LETRAS (ref.: moldura preta → quadro branco → células azuis) */
.rr-panel{position:absolute;top:8px;left:0;right:0;display:flex;flex-direction:column;
  align-items:center;gap:6px;z-index:4;pointer-events:none;}
.rr-board{background:linear-gradient(180deg,#14141f,#08080f);border-radius:16px;padding:9px;
  box-shadow:0 10px 34px rgba(0,0,0,.6),0 0 0 2px #2a2a3a inset,0 0 40px rgba(90,60,200,.15);}
.rr-board-in{background:#fff;border-radius:8px;padding:5px;display:flex;
  flex-direction:column;gap:3px;align-items:center;}
.rr-row-tiles{display:flex;gap:3px;}
.rr-cell{width:29px;height:34px;border-radius:3px;background:linear-gradient(180deg,#2e74f5,#0f47c2 60%,#0a3aa5);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.25),inset 0 -2px 3px rgba(0,0,0,.25);}
.rr-cell.slot{background:linear-gradient(180deg,#ffffff,#f2f5fc);box-shadow:0 0 0 1px #c9d4ee inset,inset 0 -2px 3px rgba(30,60,140,.12);display:flex;align-items:center;
  justify-content:center;font-size:21px;font-weight:900;font-family:'Arial Black',Arial,sans-serif;color:#0a2a7a;}
.rr-cell.rev{animation:rrflip .45s ease;background:linear-gradient(180deg,#fffef4,#ffe9a8);box-shadow:0 0 12px rgba(232,200,64,.5),0 0 0 1px #d4b542 inset;}
@keyframes rrflip{0%{transform:rotateX(90deg)}100%{transform:rotateX(0)}}
.rr-dica-banner{background:linear-gradient(180deg,#ffffff,#e8eeff);color:#0a2a7a;border-radius:9px;padding:5px 30px;
  font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:14px;letter-spacing:2px;
  box-shadow:0 4px 16px rgba(0,0,0,.5),0 0 0 2px #1e63e6 inset,0 0 24px rgba(60,110,255,.35);display:flex;align-items:center;gap:10px;}
.rr-dica-banner span{font-size:8px;color:#1e63e6;letter-spacing:3px;font-family:monospace;}
.rr-last{background:#fff;color:#0a2a7a;border-radius:6px;padding:1px 16px;
  font-family:'Arial Black',Arial,sans-serif;font-weight:900;font-size:13px;
  box-shadow:0 3px 12px rgba(0,0,0,.5);}

.rr-bubble{position:absolute;left:4%;top:15%;max-width:280px;background:#fffef2;color:#1a1004;
  border-radius:14px;border:3px solid #e8c840;padding:9px 13px;font-size:12.5px;line-height:1.5;
  z-index:6;box-shadow:0 6px 24px #000a;animation:rrpop .22s ease;font-family:sans-serif;}
.rr-bubble b{display:block;font-size:9px;letter-spacing:3px;color:#a8861a;font-family:monospace;margin-bottom:2px;}
.rr-bubble:after{content:"";position:absolute;bottom:-15px;left:42px;border:8px solid transparent;
  border-top-color:#e8c840;}
@keyframes rrpop{0%{transform:scale(.85);opacity:0}100%{transform:scale(1);opacity:1}}
.rr-valendo{position:absolute;right:5%;bottom:30%;background:#e8c840;color:#1a1004;font-weight:900;
  font-size:13px;padding:7px 16px;border-radius:10px;z-index:6;letter-spacing:1px;
  box-shadow:0 0 26px #e8c840aa;animation:rrpulse 1s ease infinite;font-family:Arial,sans-serif;}
@keyframes rrpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}

/* popup do resultado da roleta — direita, sobre a roleta */
.rr-result{position:absolute;right:4%;top:34%;z-index:7;min-width:160px;text-align:center;
  padding:14px 22px;border-radius:16px;font-family:Arial,sans-serif;
  background:linear-gradient(160deg,#fff7d6,#ffd23d 55%,#ff9d1f);color:#1a1004;
  border:3px solid #fff;box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 30px #e8c84066;
  animation:rrresult .5s cubic-bezier(.2,1.4,.5,1);}
.rr-result .rr-result-cap{display:block;font-family:monospace;font-size:9px;letter-spacing:4px;opacity:.7;}
.rr-result strong{display:block;font-size:36px;font-weight:900;line-height:1.05;margin:2px 0;
  text-shadow:0 2px 0 #fff8;}
.rr-result small{display:block;font-size:10px;font-weight:bold;opacity:.75;}
.rr-result.lose{background:linear-gradient(160deg,#3a0d0d,#190406);color:#ff8a8a;border-color:#ff4444;
  box-shadow:0 12px 40px #000a,0 0 30px #ff444455;}
.rr-result.lose strong{font-size:26px;text-shadow:0 2px 8px #f00a;}
@keyframes rrresult{0%{transform:scale(.4) rotate(-8deg);opacity:0}
  60%{transform:scale(1.08) rotate(2deg)}100%{transform:scale(1) rotate(0);opacity:1}}
.rr-bottom{position:absolute;left:0;right:0;bottom:0;z-index:6;padding:10px 14px 12px;
  background:linear-gradient(180deg,transparent,#0a0420ee 35%);display:flex;flex-direction:column;
  gap:8px;align-items:center;}
.rr-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;}
.rr-btn{background:linear-gradient(180deg,#241457,#170c3a);border:2px solid #4c3a96;color:#cfc4ff;border-radius:10px;
  padding:9px 16px;font-family:monospace;font-weight:bold;font-size:12px;letter-spacing:1px;
  cursor:pointer;transition:transform .1s ease,box-shadow .15s ease,filter .15s ease;
  box-shadow:0 3px 10px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.08);}
.rr-btn:hover:not(:disabled){transform:translateY(-2px);filter:brightness(1.15);box-shadow:0 6px 16px rgba(0,0,0,.5),0 0 14px rgba(120,90,255,.25);}
.rr-btn:active:not(:disabled){transform:translateY(0);}
.rr-btn:disabled{opacity:.35;cursor:default;}
.rr-btn.gold{background:linear-gradient(180deg,#ffe28a,#e8c840 55%,#c9a52e);border-color:#a8861a;color:#1a1004;box-shadow:0 3px 12px rgba(0,0,0,.4),0 0 20px #e8c84055,inset 0 1px 0 rgba(255,255,255,.5);}
.rr-btn.pink{background:linear-gradient(180deg,#ff6ba8,#ff3d8b 55%,#d92672);border-color:#b01b5c;color:#fff;box-shadow:0 3px 12px rgba(0,0,0,.4),0 0 20px #ff3d8b55,inset 0 1px 0 rgba(255,255,255,.35);}
.rr-btn.ghost{background:transparent;box-shadow:none;}
.rr-btn.big{font-size:14px;padding:12px 26px;}
.rr-kb{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;max-width:760px;}
.rr-key{width:36px;height:36px;border-radius:8px;background:linear-gradient(180deg,#2d1c6b,#1c1048);border:2px solid #4c3a96;
  color:#fff;font-family:Arial,sans-serif;font-weight:900;font-size:15px;cursor:pointer;
  transition:transform .08s ease,box-shadow .12s ease;box-shadow:0 2px 6px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.1);}
.rr-key:hover:not(:disabled){transform:translateY(-3px);background:linear-gradient(180deg,#3d2a85,#28185e);box-shadow:0 6px 14px rgba(0,0,0,.5),0 0 12px rgba(140,110,255,.35);border-color:#7a63d4;}
.rr-key:active:not(:disabled){transform:translateY(0);}
.rr-key:disabled{opacity:.28;cursor:default;}
.rr-key.used{opacity:.18;text-decoration:line-through;}
.rr-overlay{position:absolute;inset:0;z-index:10;background:rgba(5,2,15,.82);display:flex;
  align-items:center;justify-content:center;animation:rrpop .2s ease;}
.rr-card{background:linear-gradient(160deg,#22114d,#120833 70%,#0d0526);border:2px solid #e8c840;border-radius:18px;
  padding:26px 30px;max-width:430px;text-align:center;
  box-shadow:0 0 70px #e8c84033,0 20px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08);
  animation:rrcardglow 3s ease infinite;}
@keyframes rrcardglow{0%,100%{box-shadow:0 0 50px #e8c84028,0 20px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08)}
  50%{box-shadow:0 0 85px #e8c84048,0 20px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08)}}
.rr-card-emoji{font-size:46px;margin-bottom:6px;}
.solve-card{max-width:none;width:min(560px,92%);padding:18px 26px;}
.solve-card h3{color:#e8c840;letter-spacing:2px;font-size:16px;margin:0 0 10px;}
.rr-board.mini{transform:scale(.82);transform-origin:top center;margin:0 auto -6px;}
.rr-dica-banner.mini{font-size:12px;padding:3px 22px;margin:0 auto 12px;}
.rr-burned{background:#0a0420;border:1px solid #4c3a96;border-radius:10px;padding:8px 12px;margin:0 0 12px;}
.rr-burned > span{display:block;font-size:8px;letter-spacing:3px;color:#8b7fc4;margin-bottom:5px;}
.rr-burned-list{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;min-height:24px;align-items:center;}
.rr-burned-list b{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;
  border-radius:5px;background:#3a1414;border:1px solid #ff5a5a55;color:#ff8a8a;font-family:Arial,sans-serif;
  font-weight:900;font-size:14px;}
.rr-burned-list i{color:#6b5fa0;font-size:11px;font-style:italic;font-family:sans-serif;}
.rr-rules.tight{margin:0 0 12px;line-height:1.6;}
.rr-card h3{color:#e8c840;letter-spacing:2px;font-size:17px;margin:0 0 10px;}
.rr-rules{font-size:12px;color:#cfc4ff;line-height:1.9;font-family:sans-serif;margin:0 0 16px;}
.rr-input{width:100%;box-sizing:border-box;background:#0a0420;border:2px solid #4c3a96;border-radius:9px;
  color:#fff;font-family:monospace;font-size:15px;letter-spacing:2px;padding:11px 12px;
  text-transform:uppercase;text-align:center;margin-bottom:14px;outline:none;}
.rr-input:focus{border-color:#e8c840;}
.rr-row{display:flex;gap:8px;justify-content:center;}
.rr-final{font-size:38px;font-weight:900;color:#e8c840;font-family:Arial,sans-serif;
  text-shadow:0 0 26px #e8c84088;margin:4px 0 8px;}
.rr-bonus{display:inline-block;background:#0f3320;border:1px solid #22c55e;color:#86efac;
  font-size:10px;padding:4px 12px;border-radius:20px;letter-spacing:1px;margin-bottom:4px;}
.rr-bonus.warn{background:#3a2a08;border-color:#e8c840;color:#ffe08a;margin-bottom:10px;}
.rr-reward{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 18px;}
.rr-reward span{background:#0a0420;border:1px solid #4c3a96;border-radius:8px;padding:5px 10px;
  font-size:11px;color:#cfc4ff;}
@media (max-width:560px){
  .rr-cell{width:21px;height:26px;}
  .rr-cell.slot{font-size:14px;}
  .rr-key{width:30px;height:30px;font-size:12px;}
  .rr-logo .l1{font-size:16px;}.rr-logo .l2{font-size:18px;}
  .rr-bubble{max-width:190px;top:16%;font-size:11px;}
  .rr-valendo{font-size:11px;}
  .rr-result{min-width:120px;padding:10px 14px;}
  .rr-result strong{font-size:26px;}
}
`;



/* ═══════════════════════════════════════════════════════════════════════════
   ⚽ FUTEBOL DA CRIAÇÃO VISUAL — minigame (integrado)
   ═══════════════════════════════════════════════════════════════════════ */

const TEAMS = {
  star: { id: "star", name: "STAR WARZEA", short: "STAR", front: "#ffffff", top: "#8d9ab6" },
  lazy: { id: "lazy", name: "LAZY JOBS",  short: "LAZY", front: "#ff0a6c", top: "#1f2b44" },
};
const WIN_SCORE = 5;
const fclamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* dimensões da mesa de jogo (plano X horizontal, Z profundidade) */
const FIELD = { w: 9, d: 13, wall: 0.3 };
const PADDLE = { w: 2.0, h: 0.5, d: 0.4 };
const myZ = FIELD.d / 2 - 0.8;     // lado do jogador (perto da câmera)
const cpuZ = -FIELD.d / 2 + 0.8;   // lado da CPU (longe)

function futebolRewardFor({ win, golsFav, golsCon }) {
  if (win && golsCon === 0) return { criar: +20, socializar: +30, mexer: +25, agua: +20, label: "5×0! Atropelou o adversário na quadra." };
  if (win)                  return { criar: +15, socializar: +25, mexer: +20, agua: +15, label: "Vitória no futebol! A firma toda comentou." };
  return                      { criar: +5,  socializar: +10, mexer: +12, agua: 0,   label: "Derrota apertada. Revanche depois do expediente!" };
}

/* ── TEXTURA DO PISO (mesma várzea noturna) ───────────────────────────── */
function makeCourtTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 1024;
  const x = c.getContext("2d");
  x.fillStyle = "#2f8f57"; x.fillRect(0, 0, 1024, 1024);             // verde vivo
  x.fillStyle = "#c1452f"; x.fillRect(0, 0, 1024, 300);              // faixa coral (fundo)
  x.fillStyle = "#c1452f"; x.fillRect(0, 724, 1024, 300);           // faixa coral (frente)
  x.strokeStyle = "#f4f1e6"; x.lineWidth = 9; x.globalAlpha = 0.92;
  x.strokeRect(58, 58, 908, 908);
  x.beginPath(); x.moveTo(58, 512); x.lineTo(966, 512); x.stroke();  // meio-campo
  x.beginPath(); x.arc(512, 512, 135, 0, Math.PI * 2); x.stroke();   // círculo central
  // miolo do círculo com leve marca
  x.globalAlpha = 0.5; x.fillStyle = "#e9c84a";
  x.beginPath(); x.arc(512, 512, 70, 0, Math.PI * 2); x.fill();
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  return t;
}

/* ── CENA 3D ──────────────────────────────────────────────────────────── */
function buildFutebolScene(mount, api, refs) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#8fd0f0");   // céu azul claro
  scene.fog = new THREE.Fog("#a9def5", 34, 72);

  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 11.5, 12.5);
  camera.lookAt(0, 0.5, -1.5);

  scene.add(new THREE.AmbientLight(0xfff4e0, 0.3));
  const sun = new THREE.DirectionalLight(0xfff2d0, 1.7); sun.position.set(-6, 14, 7); scene.add(sun);
  const sky = new THREE.HemisphereLight(0xcdeeff, 0x2f5a22, 0.28); scene.add(sky);

  const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
  const Mb = (color) => new THREE.MeshBasicMaterial({ color });

  /* piso (mesa de jogo) */
  const court = new THREE.Mesh(new THREE.PlaneGeometry(FIELD.w + 1.4, FIELD.d + 1.4), new THREE.MeshBasicMaterial({ map: makeCourtTexture() }));
  court.rotation.x = -Math.PI / 2; court.position.y = 0; scene.add(court);

  /* paredes laterais verde-escuras (onde a bola quica) */
  const wallMat = Mb("#1f5c34");
  const wallGeo = new THREE.BoxGeometry(FIELD.wall, 0.6, FIELD.d + 1.4);
  const wallL = new THREE.Mesh(wallGeo, wallMat); wallL.position.set(-FIELD.w / 2 - 0.2, 0.3, 0); scene.add(wallL);
  const wallR = new THREE.Mesh(wallGeo, wallMat); wallR.position.set(FIELD.w / 2 + 0.2, 0.3, 0); scene.add(wallR);
  // faixa de grama nas laterais (continua o verde pra fora da quadra)
  // chão AZUL ao redor da quadra (#3796e8) — área de jogo até o alambrado
  const aroundMat = Mb("#3796e8");
  const around = new THREE.Mesh(new THREE.PlaneGeometry(44, 24), aroundMat);
  around.rotation.x = -Math.PI / 2; around.position.set(0, -0.05, -1); scene.add(around);
  // FUNDO VERDE atrás das grades (#43890a)
  const backdropMat = Mb("#43890a");
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(90, 50), backdropMat);
  backdrop.rotation.x = -Math.PI / 2; backdrop.position.set(0, -0.1, -FIELD.d / 2 - 22); scene.add(backdrop);
  // painel vertical verde bem ao fundo (atrás do prédio), preenche o alto atrás do alambrado
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(120, 34), backdropMat);
  backWall.position.set(0, 9, -FIELD.d / 2 - 30); scene.add(backWall);

  /* gols (linhas de fundo) */
  const goalGeo = new THREE.BoxGeometry(FIELD.w + 0.4, 0.12, 0.25);
  const goalMine = new THREE.Mesh(goalGeo, Mb("#e7e2d4")); goalMine.position.set(0, 0.06, FIELD.d / 2 + 0.5); scene.add(goalMine);
  const goalCpu = new THREE.Mesh(goalGeo, Mb("#e7e2d4")); goalCpu.position.set(0, 0.06, -FIELD.d / 2 - 0.5); scene.add(goalCpu);

  /* ── ALAMBRADO VERDE em volta (postes + tela) ── */
  const fenceMat = new THREE.MeshBasicMaterial({ color: "#2f6b3a", transparent: true, opacity: 0.4, side: THREE.DoubleSide, wireframe: true });
  const fencePostMat = M("#235029");
  const mkFence = (w, px, pz, ry) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w, 5.5, Math.round(w), 6), fenceMat);
    f.position.set(px, 2.75, pz); f.rotation.y = ry; scene.add(f);
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.1), fencePostMat); top.position.set(px, 5.5, pz); top.rotation.y = ry; scene.add(top);
  };
  mkFence(FIELD.w + 7, 0, -FIELD.d / 2 - 3.5, 0);            // fundo
  mkFence(FIELD.d + 6, -FIELD.w / 2 - 6, -1, Math.PI / 2);   // esquerda
  mkFence(FIELD.d + 6, FIELD.w / 2 + 6, -1, Math.PI / 2);    // direita
  for (let i = -3; i <= 3; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.5, 6), fencePostMat);
    p.position.set(i * 2.6, 2.75, -FIELD.d / 2 - 3.5); scene.add(p);
  }

  /* ── MORRO GRAMADO ao fundo ── */
  const hill = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), M("#43890a", { roughness: 1 }));
  hill.position.set(0, -10.5, -FIELD.d / 2 - 16); hill.scale.set(1.6, 0.5, 1); scene.add(hill);

  /* ── PRÉDIO do SBT (azul e branco) no topo do morro ── */
  const bldg = new THREE.Group(); bldg.position.set(0, 4.2, -FIELD.d / 2 - 19); scene.add(bldg);
  const bMain = new THREE.Mesh(new THREE.BoxGeometry(20, 3.2, 2), M("#eef2f6")); bldg.add(bMain);
  const bRoof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 2.2), M("#2f6fce")); bRoof.position.y = 1.85; bldg.add(bRoof);
  const bTower = new THREE.Mesh(new THREE.BoxGeometry(3, 4.2, 2.2), M("#2f6fce")); bTower.position.set(-7, 1.4, 0.2); bldg.add(bTower);
  // janelas (faixa azul clara)
  const bWin = new THREE.Mesh(new THREE.BoxGeometry(15, 1.1, 0.1), Mb("#8fd0f0")); bWin.position.set(2, 0.2, 1.02); bldg.add(bWin);

  /* palmeiras lowpoly espalhadas no morro */
  const mkPalm = (px, py, pz, s) => {
    const g = new THREE.Group(); g.position.set(px, py, pz); g.scale.setScalar(s); scene.add(g);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 3, 6), M("#8a6a3a")); trunk.position.y = 1.5; g.add(trunk);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 4), M("#2e7d32"));
      const a = (k / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.5, 3, Math.sin(a) * 0.5);
      leaf.rotation.z = Math.cos(a) * 0.9; leaf.rotation.x = Math.sin(a) * 0.9; g.add(leaf);
    }
  };
  mkPalm(-9, 0.5, -FIELD.d / 2 - 14, 1.1); mkPalm(8.5, 0.6, -FIELD.d / 2 - 14.5, 1.2);
  mkPalm(-6, 1.2, -FIELD.d / 2 - 17, 1); mkPalm(6, 1.3, -FIELD.d / 2 - 17.5, 0.9);
  mkPalm(11, 1, -FIELD.d / 2 - 16, 1);

  /* nuvens lowpoly no céu */
  const cloudMat = Mb("#ffffff");
  const mkCloud = (px, py, pz) => {
    const g = new THREE.Group(); g.position.set(px, py, pz); scene.add(g);
    [[0, 0, 1.6], [1.4, -0.2, 1.1], [-1.5, -0.1, 1.2], [0.6, 0.4, 1]].forEach(([dx, dy, r]) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), cloudMat);
      m.position.set(dx, dy, 0); g.add(m);
    });
    return g;
  };
  const clouds = [mkCloud(-12, 13, -34), mkCloud(9, 15, -38), mkCloud(0, 17, -42), mkCloud(16, 12, -30)];

  /* (tabela de basquete removida) */

  /* jogadores (formato cápsula) — corpo = cor "frente", faixa = cor "topo" */
  const mkPlayer = (front, top, z) => {
    const g = new THREE.Group(); g.position.set(0, 0.3, z); scene.add(g);
    const bodyMat = M(front, { metalness: 0.15, roughness: 0.5 });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, PADDLE.w - 0.5, 14), bodyMat);
    cyl.rotation.z = Math.PI / 2; g.add(cyl);
    const cap1 = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), bodyMat);
    cap1.position.x = (PADDLE.w - 0.5) / 2; g.add(cap1);
    const cap2 = cap1.clone(); cap2.position.x *= -1; g.add(cap2);
    const stripeMat = Mb(top);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(PADDLE.w - 0.3, 0.1, 0.16), stripeMat);
    stripe.position.y = 0.24; g.add(stripe);
    return { g, bodyMat, stripeMat };
  };
  const myP = mkPlayer("#ffffff", "#8d9ab6", myZ);
  const cpuP = mkPlayer("#ff0a6c", "#1f2b44", cpuZ);
  const myPaddle = myP.g, cpuPaddle = cpuP.g;

  /* bola de futebol (icosaedro lowpoly com manchas) */
  const BALL_R = 0.34;
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), new THREE.MeshStandardMaterial({ color: "#f4f0e2", flatShading: true }));
  ball.position.set(0, 0.34, 0); scene.add(ball);
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.CircleGeometry(0.1, 5), Mb("#1c2230"));
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI;
    sp.position.set(Math.sin(b) * Math.cos(a) * BALL_R, Math.sin(b) * Math.sin(a) * BALL_R, Math.cos(b) * BALL_R);
    sp.lookAt(sp.position.clone().multiplyScalar(2)); ball.add(sp);
  }
  // sombra simples
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 0.9, 16), new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: 0.25 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.02; scene.add(shadow);

  /* rastro da bola */
  const trail = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 5),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 }));
    scene.add(m); trail.push(m);
  }
  let trailIdx = 0, trailTimer = 0;

  /* partículas de impacto (pool reutilizável) */
  const parts = [];
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14),
      new THREE.MeshBasicMaterial({ color: "#fff", transparent: true, opacity: 0, side: THREE.DoubleSide }));
    scene.add(m); parts.push({ m, life: 0, vx: 0, vy: 0, vz: 0, vr: 0 });
  }
  const burst = (x, y, z, color, n = 10, spd = 3) => {
    let c = 0;
    for (const p of parts) {
      if (p.life > 0) continue;
      p.life = 0.45 + Math.random() * 0.35;
      p.m.material.color.set(color); p.m.material.opacity = 1;
      p.m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random());
      p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = 1.5 + Math.random() * 2.5;
      p.vr = (Math.random() - 0.5) * 10;
      if (++c >= n) break;
    }
  };

  /* SFX — WebAudio gerado em código (sem arquivos externos) */
  let audioCtx = null;
  const AC = () => (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)());
  const tone = (freq, freqEnd, dur, type = "triangle", vol = 0.15, when = 0) => {
    try {
      const a = AC(), t = a.currentTime + when;
      const o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (freqEnd && freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  };
  const crowd = (dur = 1.0, vol = 0.11) => {   // "torcida" com ruído filtrado
    try {
      const a = AC(), t = a.currentTime;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource(); src.buffer = buf;
      const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1000; f.Q.value = 0.6;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(a.destination); src.start(t);
    } catch (e) {}
  };
  const sfx = {
    kick()  { tone(200, 65, 0.11, "triangle", 0.22); },
    wall()  { tone(520, 320, 0.06, "square", 0.08); },
    serve() { tone(660, 660, 0.07, "sine", 0.08); },
    goal()  { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.28, "triangle", 0.13, i * 0.11)); crowd(1.2, 0.12); },
    win()   { [523, 659, 784, 988, 1319].forEach((f, i) => tone(f, f, 0.32, "triangle", 0.14, i * 0.14)); crowd(1.8, 0.13); },
    lose()  { [392, 330, 262].forEach((f, i) => tone(f, f * 0.94, 0.4, "sawtooth", 0.07, i * 0.22)); },
  };
  api.endSfx = (win) => (win ? sfx.win() : sfx.lose());

  /* estado do jogo / física */
  const half = { x: FIELD.w / 2 - FIELD.wall - PADDLE.w / 2 };
  const limX = FIELD.w / 2 - FIELD.wall - BALL_R;
  let vel = new THREE.Vector3();
  let running = false, targetMyX = 0, cpuSkill = 0, baseSpeed = 7;
  let spinCurve = 0, squash = 0, shake = 0;
  let prevMyX = 0, prevCpuX = 0;
  let raf = 0, prev = performance.now();
  const flash = { mine: 0, cpu: 0 };
  const CAM = { x: 0, y: 11.5, z: 12.5 };

  const launch = (towardMe) => {
    const ang = (Math.random() * 0.5 - 0.25) + (towardMe ? Math.PI / 2 : -Math.PI / 2);
    const sp = baseSpeed;
    vel.set(Math.cos(ang) * sp * 0.6, 0, Math.sin(ang) * sp);
    ball.position.set(0, 0.34, 0);
    spinCurve = 0; sfx.serve();
  };

  api.start = ({ myFront, myTop, cpuFront, cpuTop }) => {
    myP.bodyMat.color.set(myFront); myP.stripeMat.color.set(myTop);
    cpuP.bodyMat.color.set(cpuFront); cpuP.stripeMat.color.set(cpuTop);
    cpuSkill = 0; baseSpeed = 7; running = true;
    launch(Math.random() < 0.5);
  };
  api.setMyX = (nx) => { targetMyX = fclamp(nx, -1, 1) * half.x; };
  api.nudgeMyX = (dir) => { targetMyX = fclamp(targetMyX + dir * 0.6, -half.x, half.x); };
  api.setDifficulty = (level) => { cpuSkill = level; baseSpeed = 7 + level * 0.9; };
  api.pause = () => { running = false; };
  api.resume = (towardMe) => { running = true; launch(towardMe); };

  const resize = () => {
    const wpx = mount.clientWidth || 1, hpx = mount.clientHeight || 1;
    renderer.setSize(wpx, hpx, false);
    camera.aspect = wpx / hpx; camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(mount);

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - prev) / 1000, 0.033); prev = now;

    // jogador segue o alvo suavemente
    myPaddle.position.x += (targetMyX - myPaddle.position.x) * Math.min(1, dt * 14);

    // CPU: segue a bola com erro/lentidão que diminui conforme cpuSkill sobe
    const cpuMax = 3.2 + cpuSkill * 1.4;                 // velocidade máxima
    const react = 0.10 + cpuSkill * 0.14;                // qualidade de leitura
    const aimX = ball.position.x + (Math.random() - 0.5) * (1.6 - cpuSkill * 0.22);
    const desired = fclamp(aimX, -half.x, half.x);
    const step = fclamp((desired - cpuPaddle.position.x) * react, -cpuMax * dt, cpuMax * dt);
    cpuPaddle.position.x += step;

    // velocidade das barras (para o "smash")
    const myVX = fclamp((myPaddle.position.x - prevMyX) / Math.max(dt, 1e-4), -6, 6); prevMyX = myPaddle.position.x;
    const cpuVX = fclamp((cpuPaddle.position.x - prevCpuX) / Math.max(dt, 1e-4), -6, 6); prevCpuX = cpuPaddle.position.x;

    if (running) {
      const prevX = ball.position.x, prevZ = ball.position.z;
      ball.position.addScaledVector(vel, dt);

      // curva (efeito Magnus): a batida com ângulo faz a bola curvar no ar
      vel.x += spinCurve * dt * 2.2;
      spinCurve *= Math.max(0, 1 - dt * 1.1);

      // paredes laterais
      if (ball.position.x > limX) {
        ball.position.x = limX; vel.x = -Math.abs(vel.x); spinCurve *= -0.45;
        sfx.wall(); burst(limX, 0.4, ball.position.z, "#dfe8f4", 6, 2);
      }
      if (ball.position.x < -limX) {
        ball.position.x = -limX; vel.x = Math.abs(vel.x); spinCurve *= -0.45;
        sfx.wall(); burst(-limX, 0.4, ball.position.z, "#dfe8f4", 6, 2);
      }

      // colisão VARRIDA: detecta o cruzamento do plano da barra mesmo em alta velocidade
      const hitPlayer = (paddle, planeZ, movingDown, padVX, isMine, hitColor) => {
        const plane = planeZ + (movingDown ? -PADDLE.d : PADDLE.d);
        const crossed = movingDown ? (prevZ < plane && ball.position.z >= plane)
                                   : (prevZ > plane && ball.position.z <= plane);
        if (!crossed) return;
        const tC = (plane - prevZ) / ((ball.position.z - prevZ) || 1e-6);
        const xAt = prevX + (ball.position.x - prevX) * tC;
        const off = xAt - paddle.position.x;
        if (Math.abs(off) > PADDLE.w / 2 + BALL_R) return;
        const offN = fclamp(off / (PADDLE.w / 2), -1, 1);
        vel.z = movingDown ? -Math.abs(vel.z) : Math.abs(vel.z);
        vel.x += offN * 4.2 + padVX * 0.55;        // ângulo pelo contato + smash da barra em movimento
        spinCurve = offN * 5 + padVX * 0.8;        // gira a bola → curva no ar
        ball.position.z = plane; ball.position.x = xAt;
        let sp = Math.min(vel.length() * 1.06, baseSpeed * 2.4);   // acelera com teto
        const minZ = sp * 0.55;                     // garante avanço (sem bola "presa" de lado)
        if (Math.abs(vel.z) < minZ) vel.z = (vel.z < 0 ? -1 : 1) * minZ;
        vel.setLength(sp);
        squash = 1; sfx.kick();
        if (isMine) flash.mine = 0.18; else flash.cpu = 0.18;
        burst(xAt, 0.45, plane, hitColor, 8, 2.6);
      };
      if (vel.z > 0) hitPlayer(myPaddle, myZ, true, myVX, true, "#ffffff");
      else if (vel.z < 0) hitPlayer(cpuPaddle, cpuZ, false, cpuVX, false, "#ff0a6c");

      // GOL: passou da linha de fundo → festa (partículas + shake + sfx)
      if (ball.position.z > FIELD.d / 2 + 0.2) {
        running = false; shake = 0.4; sfx.goal();
        burst(ball.position.x, 0.5, FIELD.d / 2, "#ffd23d", 16, 4);
        burst(ball.position.x, 0.9, FIELD.d / 2, "#ff0a6c", 12, 3.4);
        refs.onPoint && refs.onPoint("cpu");
      } else if (ball.position.z < -FIELD.d / 2 - 0.2) {
        running = false; shake = 0.4; sfx.goal();
        burst(ball.position.x, 0.5, -FIELD.d / 2, "#ffd23d", 16, 4);
        burst(ball.position.x, 0.9, -FIELD.d / 2, "#ffffff", 12, 3.4);
        refs.onPoint && refs.onPoint("me");
      }
    }

    // giro conforme velocidade + squash no impacto
    const spd = vel.length();
    ball.rotation.x -= dt * spd * 0.6;
    ball.rotation.z += dt * spd * 0.3;
    squash = Math.max(0, squash - dt * 6);
    const sq = 1 + squash * 0.22;
    ball.scale.set(sq, 2 - sq, sq);                 // achata na batida e volta
    shadow.position.set(ball.position.x, 0.02, ball.position.z);

    // rastro da bola (mais visível quanto mais rápida)
    if (running) {
      trailTimer += dt;
      if (trailTimer > 0.028) {
        trailTimer = 0;
        const m = trail[trailIdx++ % trail.length];
        m.position.copy(ball.position);
        m.material.opacity = Math.min(0.45, 0.1 + spd * 0.02);
        m.scale.setScalar(0.6 + spd * 0.03);
      }
    }
    trail.forEach(m => { m.material.opacity = Math.max(0, m.material.opacity - dt * 1.5); });

    // partículas de impacto
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.vy -= 7 * dt;
      p.m.rotation.x += p.vr * dt; p.m.rotation.y += p.vr * 0.7 * dt;
      p.m.material.opacity = Math.max(0, Math.min(1, p.life * 2.2));
    }

    // flash das barras + shake de câmera no gol
    flash.mine = Math.max(0, flash.mine - dt);
    flash.cpu = Math.max(0, flash.cpu - dt);
    myPaddle.position.y = 0.3 + flash.mine;
    cpuPaddle.position.y = 0.3 + flash.cpu;
    shake = Math.max(0, shake - dt);
    camera.position.set(
      CAM.x + (Math.random() - 0.5) * shake * 0.7,
      CAM.y + (Math.random() - 0.5) * shake * 0.5,
      CAM.z);

    // nuvens deslizam devagar e dão a volta
    clouds.forEach((cl, i) => {
      cl.position.x += dt * (0.3 + i * 0.08);
      if (cl.position.x > 22) cl.position.x = -22;
    });

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf); ro.disconnect();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } });
    renderer.dispose();
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  };
}

/* ═══════════════════════════ ESCUDOS (SVG) ════════════════════════════ */
function CrestStar({ size = 54 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 110" aria-label="Star Warzea">
      <path d="M50 8 L88 22 L88 64 Q88 92 50 104 Q12 92 12 64 L12 22 Z" fill="#d9dbdf" stroke="#3a3d44" strokeWidth="4" />
      <path d="M50 16 L81 27 L81 63 Q81 86 50 96 Q19 86 19 63 L19 27 Z" fill="none" stroke="#5b5e66" strokeWidth="2.5" />
      <path d="M50 2 L54 20 L72 24 L54 28 L50 46 L46 28 L28 24 L46 20 Z" fill="#5b5e66" />
      <text x="50" y="56" textAnchor="middle" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="15" fill="#3a3d44">STAR</text>
      <text x="50" y="72" textAnchor="middle" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="13" fill="#3a3d44">WARZEA</text>
      <rect x="30" y="80" width="40" height="11" rx="2" fill="#5b5e66" />
      <text x="50" y="88" textAnchor="middle" fontFamily="Arial" fontWeight="700" fontSize="6" fill="#fff">• 2023 •</text>
    </svg>
  );
}
function CrestLazy({ size = 54 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label="Lazy Jobs">
      <circle cx="50" cy="50" r="48" fill="#1f2b44" />
      <path d="M50 50 m-45 0 a45 45 0 0 1 90 0 Z" fill="#ef4d5e" />
      <path d="M5 50 a45 45 0 0 0 90 0 Z" fill="#f0a93f" />
      <rect x="4" y="44" width="92" height="13" fill="#1f2b44" />
      <circle cx="50" cy="50" r="33" fill="#2f9e8f" />
      <circle cx="50" cy="50" r="29" fill="#f4ead0" />
      <circle cx="50" cy="50" r="20" fill="#fff" stroke="#1c2230" strokeWidth="1.5" />
      <path d="M50 32 l7 6 -3 9 -8 0 -3 -9 Z M37 46 l-6 7 4 8 6 -3 -1 -8 Z M63 46 l6 7 -4 8 -6 -3 1 -8 Z" fill="#1c2230" />
      <text x="50" y="20" textAnchor="middle" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="11" fill="#f4ead0">LAZY</text>
      <text x="50" y="90" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="7" fill="#1f2b44">CRIAÇÃO</text>
    </svg>
  );
}
const Crest = ({ team, size }) => team === "star" ? <CrestStar size={size} /> : <CrestLazy size={size} />;

/* ═══════════════════════════ COMPONENTE ═══════════════════════════════ */
function FutebolCriacaoVisual({ playerName = "Você", playerTeam = null, onClose, onReward }) {
  const mountRef = useRef(null);
  const apiRef = useRef({});
  const refs = useRef({});

  const [myTeam, setMyTeam] = useState(playerTeam);
  const me = myTeam === "lazy" ? TEAMS.lazy : TEAMS.star;
  const foe = myTeam === "lazy" ? TEAMS.star : TEAMS.lazy;

  const [phase, setPhase] = useState("select"); // select|playing|point|ended
  const [score, setScore] = useState({ me: 0, cpu: 0 });
  const [banner, setBanner] = useState("");
  const [result, setResult] = useState(null);
  const scoreRef = useRef({ me: 0, cpu: 0 });

  useEffect(() => {
    if (!mountRef.current) return;
    const dispose = buildFutebolScene(mountRef.current, apiRef.current, refs.current);
    return dispose;
  }, []);

  /* controles: mouse, toque e setas */
  useEffect(() => {
    const el = mountRef.current; if (!el) return;
    const onMove = (clientX) => {
      const r = el.getBoundingClientRect();
      const nx = ((clientX - r.left) / r.width) * 2 - 1;
      apiRef.current.setMyX && apiRef.current.setMyX(nx);
    };
    const mm = (e) => onMove(e.clientX);
    const tm = (e) => { if (e.touches[0]) onMove(e.touches[0].clientX); };
    const kd = (e) => {
      if (e.key === "ArrowLeft") apiRef.current.nudgeMyX && apiRef.current.nudgeMyX(-1);
      if (e.key === "ArrowRight") apiRef.current.nudgeMyX && apiRef.current.nudgeMyX(1);
    };
    el.addEventListener("mousemove", mm);
    el.addEventListener("touchmove", tm, { passive: true });
    window.addEventListener("keydown", kd);
    return () => { el.removeEventListener("mousemove", mm); el.removeEventListener("touchmove", tm); window.removeEventListener("keydown", kd); };
  }, []);

  /* ponto marcado */
  refs.current.onPoint = useCallback((who) => {
    const ns = { ...scoreRef.current, [who]: scoreRef.current[who] + 1 };
    scoreRef.current = ns; setScore(ns);
    setBanner("GOOOLLL!");

    if (ns.me >= WIN_SCORE || ns.cpu >= WIN_SCORE) {
      const win = ns.me > ns.cpu;
      setResult({ win, golsFav: ns.me, golsCon: ns.cpu });
      setPhase("ended");
      apiRef.current.pause && apiRef.current.pause();
      apiRef.current.endSfx && apiRef.current.endSfx(win);
      return;
    }
    // CPU sobe de nível conforme o total de pontos
    const level = (ns.me + ns.cpu) * 0.5 + ns.cpu * 0.3;
    apiRef.current.setDifficulty && apiRef.current.setDifficulty(level);
    setPhase("point");
    setTimeout(() => {
      setBanner("");
      setPhase("playing");
      apiRef.current.resume && apiRef.current.resume(who === "me"); // quem sofreu saca
    }, 1100);
  }, [foe.short]);

  const startGame = () => {
    setScore({ me: 0, cpu: 0 }); scoreRef.current = { me: 0, cpu: 0 };
    setPhase("playing");
    apiRef.current.start && apiRef.current.start({ myFront: me.front, myTop: me.top, cpuFront: foe.front, cpuTop: foe.top });
  };

  const reward = result ? futebolRewardFor(result) : null;

  return (
    <div className="pg-root">
      <style>{PG_CSS}</style>
      <div ref={mountRef} className="pg-canvas" />

      {/* placar topo */}
      <div className="pg-top">
        <div className={`pg-team ${myTeam ? "" : ""}`}>
          <Crest team={me.id} size={36} />
          <div className="pg-team-info"><b>{me.name}</b><small>VOCÊ</small></div>
        </div>
        <div className="pg-score"><span>{score.me}</span><em>×</em><span>{score.cpu}</span>
          <div className="pg-sub">{phase === "ended" ? "FIM" : `VENCE COM ${WIN_SCORE} GOLS`}</div>
        </div>
        <div className="pg-team right">
          <div className="pg-team-info"><b>{foe.name}</b><small>CPU</small></div>
          <Crest team={foe.id} size={36} />
        </div>
      </div>

      {banner && <div className="pg-banner" key={banner + score.me + score.cpu}>{banner}</div>}

      {/* seleção de time */}
      {phase === "select" && (
        <div className="pg-overlay">
          <div className="pg-card">
            <h3>⚽ FUTEBOL DA CRIAÇÃO VISUAL</h3>
            <p className="pg-rules">Escolha seu time para o duelo.<br /><b>Vence quem fizer {WIN_SCORE} gols primeiro!</b></p>
            <div className="pg-pick">
              <button className="pg-pick-team" onClick={() => { setMyTeam("star"); setPhase("ready"); }}>
                <Crest team="star" size={92} /><b>STAR WARZEA</b>
              </button>
              <button className="pg-pick-team" onClick={() => { setMyTeam("lazy"); setPhase("ready"); }}>
                <Crest team="lazy" size={92} /><b>LAZY JOBS</b>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* pronto pra começar (versus) */}
      {phase === "ready" && (
        <div className="pg-overlay">
          <div className="pg-card">
            <div className="pg-vs">
              <div className="pg-vs-team"><Crest team={me.id} size={84} /><b>{me.name}</b><small className="pg-you">VOCÊ</small></div>
              <span className="pg-vs-x">×</span>
              <div className="pg-vs-team"><Crest team={foe.id} size={84} /><b>{foe.name}</b><small>CPU</small></div>
            </div>
            <p className="pg-rules">Rebata a bola e faça o adversário passar do seu gol.<br />
              <b>🖱️ Mexa o mouse (ou use ← →) para mover seu jogador.</b></p>
            <button className="pg-btn gold big" onClick={startGame}>▶ COMEÇAR PARTIDA</button>
          </div>
        </div>
      )}

      {/* fim */}
      {phase === "ended" && result && (
        <div className="pg-overlay">
          <div className="pg-card">
            <div className="pg-emoji">{result.win ? "🏆" : "😞"}</div>
            <h3>{result.win ? "VITÓRIA!" : "DERROTA"}</h3>
            <div className="pg-final">{score.me} <em>×</em> {score.cpu}</div>
            <div className="pg-final-teams"><span>{me.short}</span><span>{foe.short}</span></div>
            <p className="pg-rules">{reward.label}</p>
            <div className="pg-reward">
              {reward.criar !== 0 && <span>🎨 Criar +{reward.criar}</span>}
              {reward.socializar !== 0 && <span>💬 Social +{reward.socializar}</span>}
              {reward.mexer !== 0 && <span>🏃 Mexer +{reward.mexer}</span>}
              {reward.agua !== 0 && <span>💧 Água +{reward.agua}</span>}
            </div>
            <button className="pg-btn gold big" onClick={() => { onReward && onReward(result); onClose && onClose(); }}>
              🎁 RESGATAR E VOLTAR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ESTILO (prefixo pg-) ─────────────────────────────────────────────── */
const PG_CSS = `
.pg-root{position:absolute;top:10%;left:10%;width:80%;height:80%;z-index:998;overflow:hidden;
  background:#1b4d2b;font-family:monospace;color:#fff;user-select:none;
  border:3px solid #fff;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.7);}
.pg-canvas{position:absolute;inset:0;cursor:none;}
.pg-top{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;
  justify-content:center;gap:18px;padding:9px 30px 22px;z-index:6;background:#082743;border-radius:14px;
  box-shadow:0 8px 24px rgba(0,0,0,.4);border:1px solid #ffffff22;}
.pg-team{display:flex;align-items:center;gap:8px;}
.pg-team-info b{font-size:12px;letter-spacing:1px;display:block;white-space:nowrap;}
.pg-team-info small{font-size:8px;letter-spacing:2px;color:#8893b8;}
.pg-team.right .pg-team-info{text-align:right;}
.pg-score{display:flex;align-items:center;gap:8px;font-family:'Arial Black',Arial;font-weight:900;
  font-size:30px;position:relative;}
.pg-score em{font-size:18px;color:#8893b8;font-style:normal;}
.pg-sub{position:absolute;top:calc(100% + 4px);left:50%;transform:translateX(-50%);font-family:monospace;
  font-size:9px;letter-spacing:2px;color:#9fb4d4;font-weight:normal;white-space:nowrap;}
.pg-x{position:absolute;top:12px;right:12px;z-index:9;background:#2a0c0c;border:1px solid #ff4444;color:#ff8888;
  border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:13px;font-family:monospace;}
.pg-x:hover{background:#3d0f0f;}
.pg-banner{position:absolute;top:42%;left:50%;transform:translateX(-50%);z-index:7;
  font-family:'Arial Black',Arial;font-weight:900;font-size:40px;color:#ffd23d;letter-spacing:2px;
  text-shadow:0 4px 0 #000,0 0 30px #ffd23d88;animation:pgpop .3s ease;pointer-events:none;white-space:nowrap;}
@keyframes pgpop{0%{transform:translateX(-50%) scale(.5);opacity:0}100%{transform:translateX(-50%) scale(1);opacity:1}}
.pg-hint{position:absolute;bottom:4%;left:50%;transform:translateX(-50%);z-index:5;background:#000a;
  padding:5px 14px;border-radius:20px;font-size:11px;letter-spacing:1px;color:#cdd6f0;pointer-events:none;}
.pg-overlay{position:absolute;inset:0;z-index:10;background:rgba(5,8,20,.85);display:flex;
  align-items:center;justify-content:center;animation:pgfade .2s ease;}
@keyframes pgfade{from{opacity:0}to{opacity:1}}
.pg-card{background:linear-gradient(160deg,#161d33,#0e1325);border:2px solid #ffd23d;border-radius:16px;
  padding:26px 34px;max-width:480px;text-align:center;box-shadow:0 0 70px #ffd23d22;}
.pg-card h3{color:#ffd23d;letter-spacing:2px;font-size:18px;margin:0 0 10px;}
.pg-emoji{font-size:50px;margin-bottom:4px;}
.pg-rules{font-size:12px;color:#aab4d4;line-height:1.8;font-family:sans-serif;margin:0 0 16px;}
.pg-pick{display:flex;gap:18px;justify-content:center;margin-top:8px;}
.pg-pick-team{display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;
  background:#0e1426;border:2px solid #44507a;border-radius:14px;padding:18px 24px;
  font-family:monospace;color:#cdd6f0;transition:transform .1s ease,border-color .1s ease;}
.pg-pick-team:hover{transform:translateY(-4px);border-color:#ffd23d;}
.pg-pick-team b{font-size:13px;letter-spacing:1px;}
.pg-vs{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:14px;}
.pg-vs-team{display:flex;flex-direction:column;align-items:center;gap:5px;}
.pg-vs-team b{font-size:11px;letter-spacing:1px;}
.pg-vs-team small{font-size:8px;letter-spacing:2px;color:#8893b8;}
.pg-you{background:#ffd23d;color:#1a1004;font-weight:900;padding:1px 8px;border-radius:10px;}
.pg-vs-x{font-family:'Arial Black';font-size:30px;color:#8893b8;}
.pg-final{font-family:'Arial Black',Arial;font-weight:900;font-size:46px;margin:4px 0;}
.pg-final em{color:#8893b8;font-style:normal;font-size:28px;}
.pg-final-teams{display:flex;justify-content:center;gap:60px;font-size:11px;color:#8893b8;letter-spacing:2px;margin-bottom:14px;}
.pg-btn{background:#1b2138;border:2px solid #44507a;color:#cdd6f0;border-radius:9px;padding:10px 18px;
  font-family:monospace;font-weight:bold;font-size:12px;letter-spacing:1px;cursor:pointer;transition:transform .08s ease;}
.pg-btn:hover{transform:translateY(-2px);background:#27304f;}
.pg-btn.gold{background:#ffd23d;border-color:#b8901a;color:#1a1004;}
.pg-btn.big{font-size:14px;padding:13px 30px;}
.pg-reward{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 18px;}
.pg-reward span{background:#0a0f20;border:1px solid #44507a;border-radius:8px;padding:5px 10px;font-size:11px;color:#cdd6f0;}
@media (max-width:560px){ .pg-score{font-size:22px;} .pg-banner{font-size:28px;} .pg-team-info b{font-size:10px;} }
`;


export default function SBTGame() {
  const [phase, setPhase]             = useState("intro");
  const [name, setName]               = useState("");
  const [shiftCfg, setShiftCfg]       = useState(null);
  const [turnLabels, setTurnLabels]   = useState([]);
  const [turn, setTurn]               = useState(0);
  const [scene, setScene]             = useState("praca");
  const [stats, setStats]             = useState({criar:90,socializar:90,mexer:90});
  const [agua, setAgua]               = useState(70);    // hidratação corporal
  const [garrafa, setGarrafa]         = useState(100);   // garrafa cheia = 100%
  const [log, setLog]                 = useState([]);
  const [hotspot, setHotspot]         = useState(null);
  const [npcMsg, setNpcMsg]           = useState(null);
  const [endReason, setEndReason]     = useState(null);
  const [calangoPassed, setCalangoPassed] = useState(false); // se passou no teste do calango
  const [warned, setWarned]           = useState({});
  const [locks, setLocks]             = useState({});
  const [critModal, setCritModal]     = useState(null);
  const [infoModal, setInfoModal]     = useState(null); // avisos informativos (azul)
  const [openZone, setOpenZone]       = useState(null);
  const [zonaMsg, setZonaMsg]         = useState(null); // {text, zona} — fala ou info exibida
  const [usageCounts, setUsageCounts] = useState({}); // {actionId: count}
  const [usedOnce, setUsedOnce]       = useState({}); // {actionId: true} — ações 1x por jogo (persistem entre dias)
  const [waterClicks, setWaterClicks] = useState(0);  // a cada 2 cliques, consome 1 turno
  const [usedCriticals, setUsedCriticals] = useState({}); // {eventId: true} — eventos únicos por dia
  const [musicOn, setMusicOn]         = useState(true);
  const [musicTrack, setMusicTrack]   = useState(MUSIC_MAIN);
  const [volume, setVolume]           = useState(0.35);
  const [days, setDays]               = useState(0);
  const [totalTurnsWon, setTotalTurnsWon] = useState(0);
  const [ranking, setRanking]         = useState([]);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [famosoAtual, setFamosoAtual] = useState(null);   // famoso disponível hoje na praça
  const [famosoUsado, setFamosoUsado] = useState(false);  // já tirou foto hoje
  const [cvtUnlocked, setCvtUnlocked] = useState(false);  // chave secreta pegada → CVT no dia seguinte
  const [cvtAvailable, setCvtAvailable] = useState(false); // CVT já acessível
  const [cocoVisible, setCocoVisible]   = useState(false);  // Coco Mágico disponível hoje no jornalismo
  const [saraVisible, setSaraVisible]   = useState(false);  // SARA disponível hoje no CVT
  const [veraVisible, setVeraVisible]   = useState(false);  // Vera Verão disponível hoje no Estúdio
  const [rodaOpen, setRodaOpen]         = useState(false);  // minigame Roda a Roda aberto
  const [descargasFeitas, setDescargasFeitas] = useState(false); // fez as 3 descargas → libera chamar a Loira
  const [loiraChamada, setLoiraChamada] = useState(false);  // Loira do Banheiro apareceu
  const [statFloats, setStatFloats]     = useState({});     // números flutuantes de efeito nas barras
  const [dayIntro, setDayIntro]         = useState(null);   // overlay "DIA X" na transição de dia
  const [comidaHoje, setComidaHoje]     = useState(null);   // comida do dia na ID Visual
  const [quadraReservada, setQuadraReservada] = useState(false); // reservou a quadra com o Hélder
  const [futebolUsado, setFutebolUsado] = useState(false);  // dinâmica do futebol já usada (1x no jogo, não reseta)
  const [futebolOpen, setFutebolOpen]   = useState(false);  // minigame de futebol aberto
  const floatSeq = useRef(0);
  const showFloat = (stat, delta) => {
    if(!delta) return;
    floatSeq.current++;
    setStatFloats(prev=>({...prev,[stat]:{delta,id:floatSeq.current}}));
  };
  const [thuttiGame, setThuttiGame]     = useState(null);   // estado do minigame do Thutti
  const [extChar, setExtChar]           = useState(null);   // personagem da área externa hoje
  const [lastExtChar, setLastExtChar]   = useState(null);   // id do personagem do dia anterior (não repetir)
  const audioRef                      = useRef(null);

  // Stats iniciais variam por dia
  const getInitialStats = (d) => {
    // d = expedientes já completos (0 = primeiro dia ainda)
    const day = d + 1; // dia atual (1-based)
    if(day === 1) return { criar:90, socializar:90, mexer:90 };
    if(day === 2) return { criar:70, socializar:70, mexer:70 };
    if(day === 3) return { criar:60, socializar:60, mexer:60 };
    if(day === 4) return { criar:50, socializar:50, mexer:50 };
    if(day === 5) return { criar:40, socializar:40, mexer:40 };
    if(day === 6) return { criar:30, socializar:30, mexer:30 };
    // Dia 7-16: cai -2%/dia até 10%. Depois do dia 16: cai -0.5%/dia até o piso real de 4%.
    let base;
    if(day <= 16) base = Math.max(10, 30 - (day - 6) * 2);           // dia 7=28... dia 16=10
    else          base = Math.max(4, 10 - (day - 16) * 0.5);          // dia 17=9.5... dia 28=4
    return { criar:base, socializar:base, mexer:base };
  };

  const addLog = (msg, type="normal") => setLog(p=>[{msg,type},...p].slice(0,50));

  // Sorteia famoso ao iniciar o jogo/dia (só a partir do dia 2)
  useEffect(()=>{
    if(phase!=="game") return;
    const currentDay = days + 1;
    if(currentDay >= 2 && Math.random() < 0.50){
      setFamosoAtual(sortearFamoso());
    } else {
      setFamosoAtual(null);
    }
    setFamosoUsado(false);
    // Coco Mágico no Jornalismo: 25% de chance por dia
    setCocoVisible(Math.random() < 0.25);
    // SARA no CVT: 50% de chance por dia (só relevante quando o CVT está disponível)
    setSaraVisible(Math.random() < 0.50);
    // Vera Verão no Estúdio: 25% de chance por dia, a partir do dia 5
    setVeraVisible(currentDay >= 5 && Math.random() < 0.25);
    // Personagem da Área Externa: 50% de chance/dia, sorteia entre os 3, nunca repete o do dia anterior
    if(Math.random() < 0.50){
      const pool = EXT_CHARS.filter(c => c.id !== lastExtChar);
      const escolhido = pool[Math.floor(Math.random()*pool.length)];
      setExtChar(escolhido);
      setLastExtChar(escolhido.id);
    } else {
      setExtChar(null);
    }
    // Overlay de transição "DIA X"
    setDayIntro(currentDay);
    // Comida do dia na ID Visual: sempre há uma, sorteada aleatoriamente (pode repetir)
    setComidaHoje(COMIDAS[Math.floor(Math.random()*COMIDAS.length)]);
    if(musicOn) sfx("day", volume);
    const tId = setTimeout(()=>setDayIntro(null), 2000);
    return ()=>clearTimeout(tId);
  },[phase, days]);

  // ── RANKING ────────────────────────────────────────────────────────────────
  // Título e favicon da aba
  useEffect(()=>{
    try{
      document.title = "Trampo Simulator — SBT Criação Visual";
      let link = document.querySelector("link[rel~='icon']");
      if(!link){ link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏢</text></svg>";
    }catch(e){ /* iframe restrito: segue o jogo */ }
  },[]);

  // Carrega ranking global ao montar
  useEffect(()=>{
    (async()=>{
      const data = await fetchRanking();
      setRanking(data);
    })();
  },[]);

  // Calcula pontuação: cada expediente vencido = 9h30 = 570min
  // Expedientes parciais (derrota) = turnsWon * 15min
  // days = expedientes já completos (começa em 0, incrementa ao vencer)
  // wonTurns = turnos do expediente atual (parcial ou completo)
  const calcScore = (completedDays, wonTurns) => {
    const totalMin = completedDays * 570 + wonTurns * TURN_MIN;
    const d = Math.floor(totalMin / 570);
    const remainMin = totalMin % 570;
    const h = Math.floor(remainMin / 60);
    const m = remainMin % 60;
    return { totalMin, d, h, m };
  };

  const saveToRanking = async (completedDays, wonTurns, survived) => {
    const score = calcScore(completedDays, wonTurns);
    const entry = {
      name,
      days: completedDays,
      extraTurns: wonTurns,
      totalMin: score.totalMin,
      survived,
      calango: calangoPassed,
      date: new Date().toLocaleDateString("pt-BR"),
    };
    const updated = await submitScore(entry);
    if(updated) setRanking(updated);
    else {
      // fallback local se o servidor falhar — mostra ao menos a sessão atual
      setRanking(prev => [...prev, entry].sort((a,b)=>b.totalMin-a.totalMin).slice(0,500));
    }
  };

  // Música de fundo
  useEffect(()=>{
    const audio = audioRef.current;
    if(!audio) return;
    audio.volume = volume;
    if(musicOn && phase==="game"){ audio.play().catch(()=>{}); }
    else { audio.pause(); }
  },[musicOn, phase, volume]);

  // Troca de faixa (música principal ↔ música do Thutti)
  useEffect(()=>{
    const audio = audioRef.current;
    if(!audio) return;
    if(!audio.src.endsWith(musicTrack.split("/").pop())){
      audio.src = musicTrack;
      if(musicOn && phase==="game") audio.play().catch(()=>{});
    }
  },[musicTrack]);

  useEffect(()=>{
    if(audioRef.current) audioRef.current.volume = volume;
  },[volume]);

  const incUsage = (id) => setUsageCounts(p=>({...p,[id]:(p[id]||0)+1}));

  // Limites que mudam a partir do Dia 3 (days >= 2 = terceiro dia em diante)
  const ACTION_LIMITS_DAY3 = {
    lavar_rosto:4, papo_kell:1, meme_jess:1,
    mostrar_helder:2, avisar_ferias:1, pegar_tarefa:3,
    voltinha:2, fumar:3,
    cafe_caro:0, // indisponível a partir do dia 3
  };

  const getLimit = (id) => {
    const currentDay = days + 1; // dia atual (1-based)
    if(currentDay >= 3 && ACTION_LIMITS_DAY3[id] !== undefined){
      return ACTION_LIMITS_DAY3[id];
    }
    return ACTION_LIMITS[id];
  };

  const isExhausted = (id) => {
    // Foto com famoso: disponível sempre que houver um famoso na praça e ainda não usado
    if(id==="foto_famoso"){
      if(!famosoAtual || famosoUsado) return true;
      return false;
    }
    // Ações 1x por jogo (Ambulatório): esgotadas para sempre após o uso
    if(usedOnce[id]) return true;
    const limit = getLimit(id);
    if(limit===undefined) return false;
    if(id==="voltinha_calango" && !calangoPassed) return true;
    if(id==="jogar_thutti" && !calangoPassed) return true;
    // Cadeia do Futebol (1x no jogo, não reseta):
    if(id==="reservar_quadra" && (quadraReservada || futebolUsado)) return true; // some após reservar ou após jogar
    if(id==="jogar_futebol" && (!quadraReservada || futebolUsado)) return true;  // só após reservar, some após jogar
    // Cadeia da Loira: uma vez que a ajuda foi usada (1x no jogo), toda a cadeia desativa
    if((id==="descargas_palavroes"||id==="chamar_loira") && usedOnce["pedir_loira"]) return true;
    // Chamar a Loira: só após dar as 3 descargas, e some depois que ela já foi chamada
    if(id==="chamar_loira" && (!descargasFeitas || loiraChamada)) return true;
    return (usageCounts[id]||0) >= limit;
  };

  const applyFx = (fx) => {
    if(!fx) return;
    setStats(prev=>{ const n={...prev}; for(const [k,v] of Object.entries(fx)){ if(k==="agua"||k==="garrafa") continue; if(k in n) n[k]=clamp(n[k]+v); } return n; });
    if(fx.agua!=null)    setAgua(p=>clamp(p+fx.agua));
    if(fx.garrafa!=null) setGarrafa(p=>clamp(p+fx.garrafa));
    // números flutuantes nas barras
    ["criar","socializar","mexer"].forEach(k=>{ if(fx[k]) showFloat(k, fx[k]); });
    if(fx.agua) showFloat("agua", fx.agua);
  };

  // Beber água: consome 25% da garrafa, +20% de hidratação; a cada 2 cliques gasta 1 turno (15min)
  const drinkWater = () => {
    if(garrafa<=0){ addLog("🪣 A garrafa está vazia! Encha no corredor.","warn"); return; }
    setGarrafa(p=>clamp(p-25));
    setAgua(p=>clamp(p+20));
    showFloat("agua", 20);
    if(musicOn) sfx("water", volume);
    addLog(`💧 ${name} tomou um gole de água. Garrafa −25%.`, "water");
  };

  // Hidratação: −10% em ações de mov. e soc. independente da duração
  const drainHydIfNeeded = (id) => {
    const cat = ACTION_CAT[id];
    if(cat==="mexer"||cat==="socializar"){ setAgua(p=>clamp(p-10)); showFloat("agua", -10); }
  };

  // Taxa de drenagem de hidratação por turno — escala com o dia (aperta gradualmente)
  // Dia 1-6: 1%/turno. A partir do dia 7: +0.1%/turno por dia, até o teto de 2.5%/turno.
  const hydDrainRate = () => {
    const currentDay = days + 1;
    if(currentDay <= 6) return 1;
    return Math.min(2.5, 1 + (currentDay - 6) * 0.1);
  };

  const advanceTurns = (amount) => {
    if(amount<=0) return;
    // Hidratação diminui naturalmente com o tempo (taxa cresce nos dias avançados)
    setAgua(p=>clamp(p - amount * hydDrainRate()));
    setLocks(prev=>{ const n={}; for(const [k,v] of Object.entries(prev)){ const nv=v-amount; if(nv>0) n[k]=nv; } return n; });
    setTurn(p=>{
      const nt=p+amount;
      if(nt>=TOTAL_TURNS){
        setTimeout(()=>{
          setTotalTurnsWon(pt => pt + TOTAL_TURNS);
          setPhase("nextday");
        }, 600);
      }
      return nt;
    });
  };

  // A partir do dia 6, eventos críticos bloqueiam +1 turno por dia, até o dobro do valor original
  const scaledLockTurns = (baseTurns) => {
    const currentDay = days + 1;
    if(currentDay < 6) return baseTurns;
    const bonus = Math.min(currentDay - 5, baseTurns); // dia6=+1, dia7=+2... limitado ao valor base
    return baseTurns + bonus; // máximo = 2× baseTurns
  };

  const maybeCritical = (sceneId) => {
    const evts = CRITICAL_EVENTS[sceneId];
    if(!evts) return;
    // eventos raros têm 5% de chance, normais 20%
    // eventos com oncePer="day" só disparam se ainda não ocorreram hoje
    const pool = evts.filter(ev => {
      if(ev.oncePer==="day" && usedCriticals[ev.id]) return false;
      const chance = ev.chance != null ? ev.chance : (ev.raro ? 0.05 : 0.20);
      return Math.random() < chance;
    });
    if(pool.length===0) return;
    const ev = pool[Math.floor(Math.random()*pool.length)];
    if(ev.oncePer==="day") setUsedCriticals(prev=>({...prev,[ev.id]:true}));
    const lockT = scaledLockTurns(ev.turns);
    if(ev.type==="lock")       setLocks(prev=>({...prev,[ev.category]:Math.max(prev[ev.category]||0,lockT)}));
    if(ev.type==="lock_multi") ev.categories.forEach(cat=>setLocks(prev=>({...prev,[cat]:Math.max(prev[cat]||0,lockT)})));
    else if(ev.type==="set_stat"){ if(ev.stat==="agua") setAgua(ev.value); else setStats(prev=>({...prev,[ev.stat]:ev.value})); }
    // passa o turns escalonado pro modal exibir a duração real
    setCritModal({...ev, turns: (ev.type==="lock"||ev.type==="lock_multi") ? lockT : ev.turns});
    if(musicOn) sfx("critical", volume);
    addLog(`🚨 EVENTO CRÍTICO: ${ev.title}`,"critical");
  };

  const isActionLocked = (id) => { const cat=ACTION_CAT[id]; return cat&&(locks[cat]||0)>0; };

  const isAvail = (a) => {
    if(a.availDay && (days+1) < a.availDay) return false;
    if(!shiftCfg) return true;
    if(a.availFrom && turn < timeToTurn(a.availFrom, shiftCfg.startH, shiftCfg.startM)) return false;
    if(a.availUntil && turn > timeToTurn(a.availUntil, shiftCfg.startH, shiftCfg.startM)) return false;
    return true;
  };

  const doAction = (a) => {
    if(turn>=TOTAL_TURNS) return;
    if(isActionLocked(a.id)) return;
    if(!isAvail(a)) return;
    if(isExhausted(a.id)) return;

    const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)];

    // Navigate
    if(a.navigate){ setScene(a.navigate); if(a.msg) addLog(`[${lbl}] ${a.emoji} ${a.msg}`); setOpenZone(null); setHotspot(null); setNpcMsg(null); return; }

    // Drink (click na garrafa na ID Visual)
    if(a.special==="drink"){ drinkWater(); setOpenZone(null); return; }

    // Roda a Roda — abre o minigame do Estúdio (turno gasto ao resgatar)
    if(a.special==="rodaroda"){
      incUsage(a.id);
      setOpenZone(null); setHotspot(null);
      addLog(`[${lbl}] 🎡 ${a.msg}`);
      setMusicTrack(MUSIC_RODA);
      setRodaOpen(true);
      return;
    }

    // Thutti Jogos — abre o minigame de cartas+dado (turno gasto ao finalizar)
    if(a.special==="thutti"){
      incUsage(a.id);
      setOpenZone(null); setHotspot(null);
      addLog(`[${lbl}] 🎲 ${a.msg}`);
      setMusicTrack(MUSIC_THUTTI);
      setThuttiGame({ cards:[], total:0, dado:null, fase:"rolar", resultado:null });
      return;
    }

    // Encher garrafa
    if(a.special==="encher"){ setGarrafa(100); applyFx(a.effects); drainHydIfNeeded(a.id); incUsage(a.id); addLog(`[${lbl}] 🫙 Garrafa enchida! ${a.msg} (15min)`); advanceTurns(a.time); maybeCritical(scene); setOpenZone(null); setHotspot(null); return; }

    // Fumar
    if(a.special==="fumar"){ setAgua(p=>clamp(p/2)); }

    // Cochilo
    if(a.special==="cochilo"){
      const r=Math.random();
      let ct,fx,label;
      if(r<0.35)     { ct=2;  fx={criar:+60,mexer:0,  socializar:0}; label="30min · Cochilo perfeito! Acordou renovado."; }
      else if(r<0.65){ ct=4;  fx={criar:+30,mexer:0,  socializar:0}; label="1h · Acordou com marca de teclado na bochecha."; }
      else if(r<0.85){ ct=6;  fx={criar:-10,mexer:-40,socializar:0}; label="1h30 · Dormiu demais. Pescoço torto."; }
      else            { ct=8;  fx={criar:-30,mexer:-50,socializar:0}; label="2h · DORMIU 2 HORAS! Todo mundo viu."; }
      applyFx(fx); incUsage(a.id);
      addLog(`[${lbl}] 💤 Cochilo: ${label}`, ct>=6?"warn":"normal");
      advanceTurns(ct); maybeCritical("banheiro");
      setOpenZone(null); setHotspot(null); setNpcMsg(null); return;
    }

    // Calango
    if(a.special==="calango_risk"){
      const intox=Math.random()<0.30;
      incUsage(a.id);
      if(intox){
        setAgua(10); applyFx({criar:0,mexer:-20,socializar:0});
        addLog(`[${lbl}] 🦎😱 INTOXICAÇÃO ALIMENTAR! Banheiro urgente.`,"critical");
        setScene("banheiro");
      } else {
        setCalangoPassed(true);
        applyFx({criar:0,mexer:0,socializar:+50});
        addLog(`[${lbl}] 🦎✅ Passou no teste do Calango! +50% socialização.`);
        setInfoModal({
          emoji:"🦎",
          title:"Você passou no teste do Calango!",
          msg:"🎲 Thutti Jogos liberado\n🚶 Voltinha pós-Calango liberada (na Área Externa)",
        });
      }
      advanceTurns(a.time||4); setOpenZone(null); setHotspot(null); setNpcMsg(null); return;
    }

    // Voltinha pós-Calango
    if(a.special==="voltinha_pos"){
      if(!calangoPassed){ addLog("🦎 Só disponível após passar no teste do Calango!","warn"); return; }
    }

    // Água de Coco Mágica — restaura hidratação 100%
    if(a.id==="agua_coco"){
      setAgua(100); incUsage(a.id);
      const lbl2=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lbl2}] 🥥 ${a.msg}`,"water"); return;
    }

    // SARA — desbloqueia todas as categorias bloqueadas
    if(a.special==="sara"){
      setLocks({});
      incUsage(a.id);
      const lbls=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lbls}] 🤖 ${a.msg}`,"info");
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Dar 3 descargas e falar 3 palavrões — libera chamar a Loira do Banheiro
    if(a.special==="descargas"){
      incUsage(a.id);
      setDescargasFeitas(true);
      const lbld=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lbld}] 🚽 ${a.msg} (15min)`);
      advanceTurns(a.time); maybeCritical(scene);
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Chamar a Loira do Banheiro — faz a Loira aparecer no espelho
    // Reservar quadra com o Hélder → libera Jogar Futebol no segurança
    if(a.special==="reservar_quadra"){
      incUsage(a.id);
      setQuadraReservada(true);
      const lblrq=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lblrq}] ⚽ Quadra reservada, pegue a chave com o segurança.`,"info");
      setZonaMsg({text:`👨‍💼 "Reservei aqui no sistema já, agora é só pegar a chave com o segurança."`, zona:"zona2"});
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Jogar Futebol — abre o minigame (ganhar → próximo dia, perder → game over)
    if(a.special==="futebol"){
      incUsage(a.id);
      setFutebolUsado(true);
      setOpenZone(null); setHotspot(null); setZonaMsg(null);
      const lblf=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lblf}] ⚽ ${a.msg}`);
      setMusicTrack(MUSIC_RODA);
      setFutebolOpen(true);
      return;
    }

    // Comer comida do dia (ID Visual) — efeitos e fala vêm da comida sorteada
    if(a.special==="comida"){
      if(!comidaHoje) return;
      const c = comidaHoje;
      applyFx(c.effects);
      if(c.effects.aguaSet!=null){ setAgua(c.effects.aguaSet); showFloat("agua", c.effects.aguaSet); } // define hidratação (ex: mofado → 10%)
      incUsage(a.id);
      if(musicOn) sfx("action", volume);
      const lblco=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lblco}] 🍽️ ${c.nome}: "${c.fala}"`);
      setOpenZone(null); setHotspot(null); setZonaMsg(null);
      return;
    }

    if(a.special==="chamar_loira"){
      incUsage(a.id);
      setLoiraChamada(true);
      const lblcl=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lblcl}] 🪞 ${a.msg}`,"info");
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Loira do Banheiro — desbloqueia todas as categorias (1x no jogo)
    if(a.special==="loira"){
      setLocks({});
      incUsage(a.id);
      setUsedOnce(prev=>({...prev,[a.id]:true}));
      const lbll=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lbll}] 👻 ${a.msg}`,"info");
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Chave Secreta — libera CVT no dia seguinte
    if(a.special==="chave_secreta"){
      if(cvtUnlocked||cvtAvailable) return;
      setCvtUnlocked(true); incUsage(a.id);
      const lblc=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lblc}] 🗝️ ${a.msg}`,"info");
      setOpenZone(null); setHotspot(null);
      return;
    }

    // Foto com famoso — usa o famoso sorteado no início do dia
    if(a.special==="foto_famoso"){
      if(!famosoAtual||famosoUsado) return;
      const f = famosoAtual;
      applyFx(f.effects);
      drainHydIfNeeded(a.id);
      incUsage(a.id);
      setFamosoUsado(true);
      const lbl3=turnLabels[Math.min(turn,TOTAL_TURNS-1)];
      addLog(`[${lbl3}] 📸 ${f.emoji} ${f.nome}: "${f.frase}"`);
      advanceTurns(a.time);
      maybeCritical(scene);
      setOpenZone(null); setHotspot(null);
      return;
    }

    if(a.npcId&&NPCS[a.npcId]){
      const npc=NPCS[a.npcId];
      setNpcMsg({npc,line:npc.chat[Math.floor(Math.random()*npc.chat.length)]});
    }

    applyFx(a.effects);
    drainHydIfNeeded(a.id);
    incUsage(a.id);
    if(a.onceGame) setUsedOnce(prev=>({...prev,[a.id]:true}));
    if(musicOn) sfx("action", volume);

    const tl = a.time===0?"instantâneo":`${a.time*15}min`;
    addLog(`[${lbl}] ${a.emoji} ${a.msg} (${tl})`);

    if(a.time>0){ advanceTurns(a.time); maybeCritical(scene); }
    setOpenZone(null); setHotspot(null);
  };

  // ── MINIGAME DO THUTTI — "21 do Thutti" (cartas + dado de risco) ──────────────
  // Rola o dado (define o modificador da próxima carta)
  const thuttiRolar = () => {
    setThuttiGame(g => {
      if(!g || g.fase!=="rolar") return g;
      const dado = 1 + Math.floor(Math.random()*6);
      return { ...g, dado, fase:"comprar" };
    });
  };

  // Compra uma carta aplicando o modificador do dado
  const thuttiComprar = () => {
    setThuttiGame(g => {
      if(!g || g.fase!=="comprar") return g;
      const raw = 1 + Math.floor(Math.random()*10); // carta 1-10
      let val = raw;
      let mod = "";
      if(g.dado<=2){ val = Math.floor(raw/2); mod="½"; }       // seguro
      else if(g.dado<=4){ val = raw; mod=""; }                  // normal
      else { val = raw + 3; mod="+3"; }                         // arriscado
      const naipes = ["♠","♥","♦","♣"];
      const naipe = naipes[Math.floor(Math.random()*4)];
      const cards = [...g.cards, { raw, val, mod, dado:g.dado, naipe }];
      const total = g.total + val;
      if(total > 21){
        // estourou
        return { ...g, cards, total, dado:null, fase:"fim", resultado:"estourou" };
      }
      return { ...g, cards, total, dado:null, fase:"rolar" };
    });
  };

  // Jogador decide parar — avalia o resultado
  const thuttiParar = () => {
    setThuttiGame(g => {
      if(!g || (g.fase!=="rolar" && g.fase!=="comprar")) return g;
      let resultado;
      if(g.total === 21) resultado = "perfeito";
      else if(g.total >= 18) resultado = "bom";
      else resultado = "fraco";
      return { ...g, dado:null, fase:"fim", resultado };
    });
  };

  // Fecha o pop-up e aplica os efeitos do resultado + gasta o turno
  const thuttiFinalizar = () => {
    const g = thuttiGame;
    setThuttiGame(null);
    setMusicTrack(MUSIC_MAIN);
    if(!g) return;
    const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)];
    let fx = {criar:0,mexer:0,socializar:0}, msg = "";
    if(g.resultado==="perfeito"){ fx={criar:+30,mexer:+30,socializar:+30}; msg="21 CRAVADO! O Thutti aplaudiu de pé. Você é uma lenda dos boardgames."; }
    else if(g.resultado==="bom"){ fx={criar:+10,mexer:0,socializar:+20}; msg=`Você parou em ${g.total}. Mão sólida! O Thutti respeitou.`; }
    else if(g.resultado==="fraco"){ fx={criar:0,mexer:0,socializar:+10}; msg=`Você parou em ${g.total}. Jogou seguro demais, mas valeu a diversão.`; }
    else { fx={criar:-10,mexer:0,socializar:-20}; msg=`Você estourou com ${g.total}! O Thutti riu. Fica pra próxima.`; }
    applyFx(fx);
    addLog(`[${lbl}] 🎲 ${msg} (30min)`);
    advanceTurns(2);   // 2 turnos = 30min
    maybeCritical("calango");
  };

  // ── RODA A RODA — recompensa ao final do minigame ─────────────────────────────
  const rodaReward = (prize) => {
    const r = rodaRewardFor(prize);
    const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)];
    applyFx({criar:r.criar||0, mexer:r.mexer||0, socializar:r.socializar||0, agua:r.agua||0});
    addLog(`[${lbl}] 🎡 Roda a Roda: R$ ${prize} — ${r.label} (30min)`);
    advanceTurns(2);   // 2 turnos = 30min
    maybeCritical("estudio");
  };
  const rodaClose = () => {
    setRodaOpen(false);
    setMusicTrack(MUSIC_MAIN);
  };

  // ── FUTEBOL DA CRIAÇÃO VISUAL — resultado ─────────────────────────────────────
  // Vencer → avança automaticamente para o próximo dia. Perder → GAME OVER.
  const futebolReward = (result) => {
    setFutebolOpen(false);
    setMusicTrack(MUSIC_MAIN);
    const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)];
    if(result && result.win){
      addLog(`[${lbl}] ⚽🏆 VITÓRIA no futebol da Criação Visual! ${result.golsFav}×${result.golsCon}. Expediente encerrado com chave de ouro!`,"info");
      setTotalTurnsWon(pt => pt + TOTAL_TURNS);
      setPhase("nextday");
    } else {
      addLog(`[${lbl}] ⚽😞 Derrota no futebol... ${result?result.golsFav:0}×${result?result.golsCon:5}. Você perdeu o jogo e o emprego.`,"critical");
      setEndReason("Perdeu no futebol");
      saveToRanking(days, turn, false);
      if(musicOn) sfx("gameover", volume);
      setPhase("end");
    }
  };
  const futebolClose = () => {
    // fechar sem resultado não é permitido no fluxo; mantido por segurança
    setFutebolOpen(false);
    setMusicTrack(MUSIC_MAIN);
  };

  // game over / vitória
  useEffect(()=>{
    if(phase!=="game") return;
    const all={...stats,agua};
    const labels={criar:"Sem criatividade",socializar:"Sem socialização",mexer:"Sem movimentação",agua:"Desidratação"};
    const dead=Object.entries(all).find(([,v])=>v<=0);
    if(dead){
      setEndReason(labels[dead[0]]);
      saveToRanking(days, turn, false);
      if(musicOn) sfx("gameover", volume);
      setPhase("end");
      return;
    }
    Object.entries(all).forEach(([k,v])=>{
      if(v<=WARN&&!warned[k]){setWarned(p=>({...p,[k]:true}));addLog(`⚠️ ATENÇÃO: ${k.toUpperCase()} está crítica!`,"warn");}
      if(v>WARN&&warned[k])   setWarned(p=>({...p,[k]:false}));
    });
  },[stats,agua]);

  const resetGame = ()=>{
    setPhase("intro");setTurn(0);setScene("praca");
    setStats({criar:90,socializar:90,mexer:90});setAgua(70);setGarrafa(100);
    setLog([]);setHotspot(null);setNpcMsg(null);setEndReason(null);
    setCalangoPassed(false);setWarned({});setName("");setShiftCfg(null);
    setLocks({});setCritModal(null);setInfoModal(null);setOpenZone(null);setUsageCounts({});
    setWaterClicks(0);setDays(0);setTotalTurnsWon(0);setShowRanking(false);setUsedCriticals({});setFamosoAtual(null);setFamosoUsado(false);setZonaMsg(null);setCvtUnlocked(false);setCvtAvailable(false);setCocoVisible(false);setSaraVisible(false);setThuttiGame(null);setMusicTrack(MUSIC_MAIN);setUsedOnce({});setExtChar(null);setLastExtChar(null);setVeraVisible(false);setRodaOpen(false);setDescargasFeitas(false);setLoiraChamada(false);setComidaHoje(null);setQuadraReservada(false);setFutebolUsado(false);setFutebolOpen(false);
  };

  // Continua para o próximo dia sem resetar tudo
  const nextDay = () => {
    const newDays = days + 1;
    setDays(newDays);
    setTurn(0); setScene("praca");
    setStats(getInitialStats(newDays));
    setAgua(70); setGarrafa(100);
    setLog([]); setUsageCounts({}); setWaterClicks(0);
    setCalangoPassed(false); setWarned({}); setLocks({});
    setCritModal(null); setOpenZone(null); setHotspot(null); setNpcMsg(null);
    setUsedCriticals({}); setFamosoAtual(null); setFamosoUsado(false);
    setZonaMsg(null); setThuttiGame(null); setMusicTrack(MUSIC_MAIN);
    setDescargasFeitas(false);
    setPhase("game");
    // Liberação progressiva de ambientes (newDays = expedientes completos; dia que inicia = newDays+1)
    const diaAtual = newDays + 1;
    if(diaAtual === 2){
      setInfoModal({
        emoji:"🎥",
        title:"Novo ambiente: Switcher!",
        msg:"O Switcher agora está acessível pelo menu de navegação. Programe tarjas, disponibilize artes e beba água por lá também.",
      });
      addLog("🎥 Novo ambiente disponível: Switcher!", "info");
    } else if(diaAtual === 3){
      setInfoModal({
        emoji:"🏥",
        title:"Novo ambiente: Ambulatório!",
        msg:"O Ambulatório agora está acessível pelo menu.\n\n⚠️ Atenção: cada ação do Ambulatório só pode ser usada UMA ÚNICA VEZ durante todo o jogo — use com sabedoria!",
      });
      addLog("🏥 Novo ambiente disponível: Ambulatório!", "info");
    } else if(diaAtual === 4){
      setInfoModal({
        emoji:"🎬",
        title:"Novo ambiente: Estúdio!",
        msg:"O Estúdio agora está acessível pelo menu de navegação. Corra do King Kong, jogue Roda a Roda e descubra os segredos do palco.",
      });
      addLog("🎬 Novo ambiente disponível: Estúdio!", "info");
    }
    // CVT liberado se a chave secreta foi pega no dia anterior
    if(cvtUnlocked && !cvtAvailable){
      setCvtAvailable(true);
      setCvtUnlocked(false);
      setInfoModal({
        emoji:"📺",
        title:"Novo ambiente disponível!",
        msg:"O CVT (Novela) agora está acessível pelo menu de navegação. A chave secreta abriu caminho.",
      });
      addLog("📺 Novo ambiente disponível: CVT (Novela)!", "info");
    }
  };

  const handleStart=(n,s)=>{
    // Reseta todo o estado de jogo antes de iniciar (evita log/stats do jogo anterior)
    setTurn(0); setScene("praca");
    setStats({criar:90,socializar:90,mexer:90}); setAgua(70); setGarrafa(100);
    setLog([]); setHotspot(null); setNpcMsg(null); setEndReason(null);
    setCalangoPassed(false); setWarned({});
    setLocks({}); setCritModal(null); setOpenZone(null); setUsageCounts({});
    setWaterClicks(0); setDays(0); setTotalTurnsWon(0); setUsedCriticals({});
    setFamosoAtual(null); setFamosoUsado(false); setZonaMsg(null);
    setCvtUnlocked(false); setCvtAvailable(false); setInfoModal(null); setCocoVisible(false); setSaraVisible(false); setThuttiGame(null); setMusicTrack(MUSIC_MAIN); setUsedOnce({}); setExtChar(null); setLastExtChar(null); setVeraVisible(false); setRodaOpen(false); setDescargasFeitas(false); setLoiraChamada(false); setComidaHoje(null); setQuadraReservada(false); setFutebolUsado(false); setFutebolOpen(false);
    // Configura o novo jogo
    setName(n); setShiftCfg(s); setTurnLabels(genLabels(s.startH,s.startM));
    setPhase("game");
  };

  const openRanking = async () => {
    setRankingLoading(true);
    setPhase("ranking");
    const data = await fetchRanking();
    setRanking(data);
    setRankingLoading(false);
  };

  // ── LAYOUT RESPONSIVO ─────────────────────────────────────────────────────
  // O jogo foi desenhado em 1280×720. Escalamos proporcionalmente para caber
  // em qualquer janela, mantendo o aspect ratio e centralizando.
  const [scale, setScale] = useState(1);
  useEffect(()=>{
    const calc = () => {
      const sx = (window.innerWidth  - 120) / 1280;
      const sy = (window.innerHeight - 120) / 720;
      setScale(Math.min(sx, sy, 1.5)); // máximo 1.5× (1920×1080), margem de 60px
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const W = {
    width:"1280px", height:"720px",
    position:"relative", overflow:"hidden",
    fontFamily:"'Courier New',monospace", background:"#070710",
    transform:`scale(${scale})`, transformOrigin:"top left",
    flexShrink:0,
  };
  const OUTER = {
    width:"100vw", height:"100vh",
    overflow:"hidden", position:"relative",
    background:"#070710",
    display:"flex", alignItems:"center", justifyContent:"center",
  };
  // O inner precisa de um container que centraliza o W escalado
  const SCALED_W = Math.round(1280 * scale);
  const SCALED_H = Math.round(720  * scale);
  const INNER = {
    width:`${SCALED_W}px`, height:`${SCALED_H}px`,
    position:"relative", overflow:"hidden", flexShrink:0,
  };

  if(phase==="intro") return (
    <div style={OUTER}><div style={INNER}><div style={W}>
      <audio ref={audioRef} src="https://res.cloudinary.com/dio7kf0tb/video/upload/v1777134013/Mofadinho_Salgado___Game_V4_ijxoys.mp3" loop preload="auto"/>
      <Intro onStart={handleStart} onRanking={openRanking}/>
    </div></div></div>
  );

  if(phase==="ranking") return (
    <RankingScreen
      ranking={ranking}
      loading={rankingLoading}
      onBack={()=>setPhase("intro")}
      highlightName={name}
      highlightMin={calcScore(days, endReason?turn:TOTAL_TURNS).totalMin}
      W={W} OUTER={OUTER} INNER={INNER}
    />
  );

  if(phase==="nextday"){
    const score = calcScore(days, TOTAL_TURNS);
    return (
      <div style={OUTER}><div style={INNER}><div style={{...W,background:"linear-gradient(135deg,#001a00,#002800)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{maxWidth:520,textAlign:"center",padding:24}}>
          <div style={{fontSize:60,marginBottom:8}}>🌅</div>
          <div style={{fontSize:10,color:"#e8c840",letterSpacing:4,textTransform:"uppercase",marginBottom:4,fontFamily:"monospace"}}>Expediente concluído!</div>
          <h2 style={{color:"#66ff66",fontSize:24,marginBottom:6,fontFamily:"monospace"}}>Dia {days+1} vencido!</h2>
          <p style={{color:"#888",fontSize:12,lineHeight:1.8,marginBottom:20,fontFamily:"sans-serif"}}>
            {name} sobreviveu mais um expediente no SBT.<br/>
            Amanhã começa tudo de novo. As barras resetaram.<br/>
            <span style={{color:"#e8c840"}}>Sobrevivência acumulada: {score.d > 0 ? `${score.d} dia${score.d!==1?"s":""} e ` : ""}{score.h}h{score.m > 0 ? ` ${score.m}min` : ""}</span>
          </p>
          {(()=>{ const ns = getInitialStats(days+1); return (
            <div style={{background:"#0a0a18",border:"1px solid #2a2a4a",borderRadius:8,padding:"10px 16px",marginBottom:16,fontSize:11,color:"#888",fontFamily:"monospace"}}>
              <span style={{color:"#555",fontSize:9,letterSpacing:2,textTransform:"uppercase"}}>Stats de amanhã (dia {days+2}) → </span>
              <span style={{color:"#5b8dee"}}>🎨 {ns.criar}%</span>{"  "}
              <span style={{color:"#a855f7"}}>💬 {ns.socializar}%</span>{"  "}
              <span style={{color:"#22c55e"}}>🏃 {ns.mexer}%</span>
            </div>
          );})()}
          {calangoPassed&&<div style={{background:"#0a1500",border:"1px solid #22c55e",borderRadius:6,padding:"8px 12px",marginBottom:16,fontSize:12,color:"#22c55e"}}>🦎 Sobreviveu ao Calango ontem. Lendário.</div>}
          <div style={{display:"flex",gap:10,justifyContent:"center"}}>
            <button onClick={nextDay} style={{background:"#22c55e",color:"#000",border:"none",padding:"12px 28px",borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"monospace",fontWeight:"bold"}}>
              ☀️ Próximo Expediente
            </button>
            <button onClick={async()=>{ await saveToRanking(days+1, TOTAL_TURNS, true); setEndReason(null); setPhase("end"); }}
              style={{background:"#333",color:"#aaa",border:"1px solid #444",padding:"12px 20px",borderRadius:8,cursor:"pointer",fontSize:13,fontFamily:"monospace"}}>
              🚪 Encerrar e ver pontuação
            </button>
          </div>
        </div>
      </div></div></div>
    );
  }

  if(phase==="end"){
    const survived = !endReason;
    const score = calcScore(days, survived ? TOTAL_TURNS : turn);

    const formatTime = (d,h,m) => {
      const parts=[];
      if(d>0) parts.push(`${d} dia${d!==1?"s":""}`);
      if(h>0) parts.push(`${h}h`);
      if(m>0) parts.push(`${m}min`);
      return parts.length>0?parts.join(" e "):"menos de 1min";
    };

    return (
      <div style={OUTER}><div style={INNER}><div style={{...W,background:survived?"linear-gradient(135deg,#001500,#002000)":"linear-gradient(135deg,#150000,#200000)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:440,padding:"0 24px",textAlign:"center"}}>

          <div>
            <div style={{fontSize:56,marginBottom:8}}>{survived?"🏆":"😵"}</div>
            <div style={{fontSize:9,color:"#e8c840",letterSpacing:4,textTransform:"uppercase",marginBottom:4,fontFamily:"monospace"}}>{survived?"Expediente concluído!":"Fim de expediente"}</div>
            <h2 style={{color:survived?"#66ff66":"#ff6666",fontSize:20,marginBottom:8,fontFamily:"monospace",lineHeight:1.3}}>
              {survived?`${name} se aposentou no SBT!`:`${name} não resistiu`}
            </h2>
            {!survived&&(
              <div style={{margin:"6px auto 14px",display:"inline-block",background:"#2a0808",border:"2px solid #ff4444",borderRadius:8,padding:"8px 20px"}}>
                <div style={{fontSize:9,color:"#ff8888",letterSpacing:2,textTransform:"uppercase",marginBottom:2,fontFamily:"monospace"}}>Causa da derrota</div>
                <div style={{fontSize:20,color:"#ff4444",fontWeight:"bold",fontFamily:"monospace",letterSpacing:1,textTransform:"uppercase"}}>
                  {endReason}!
                </div>
              </div>
            )}

            {/* PLACAR */}
            <div style={{background:"#0d0d18",border:"2px solid #e8c840",borderRadius:12,padding:"16px 20px",marginBottom:14,textAlign:"center"}}>
              <div style={{fontSize:9,color:"#e8c840",letterSpacing:3,textTransform:"uppercase",marginBottom:8,fontFamily:"monospace"}}>⏱ Tempo de Sobrevivência</div>
              <div style={{fontSize:28,fontWeight:"bold",color:"#fff",fontFamily:"monospace",letterSpacing:2,marginBottom:4}}>
                {formatTime(score.d, score.h, score.m)}
              </div>
              <div style={{display:"flex",justifyContent:"center",gap:20,marginTop:10}}>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:"bold",color:"#e8c840",fontFamily:"monospace"}}>{days+(survived?0:0)}</div>
                  <div style={{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1}}>expediente{days!==1?"s":""} completo{days!==1?"s":""}</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontSize:22,fontWeight:"bold",color:"#a855f7",fontFamily:"monospace"}}>{score.h}h{score.m>0?`${score.m}m`:""}</div>
                  <div style={{fontSize:8,color:"#555",textTransform:"uppercase",letterSpacing:1}}>no último dia</div>
                </div>
                {calangoPassed&&<div style={{textAlign:"center"}}>
                  <div style={{fontSize:22}}>🦎</div>
                  <div style={{fontSize:8,color:"#22c55e",textTransform:"uppercase",letterSpacing:1}}>calango</div>
                </div>}
              </div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button onClick={resetGame} style={{background:"#e8c840",color:"#000",border:"none",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"monospace",fontWeight:"bold"}}>
                🔄 Novo Expediente
              </button>
              <button onClick={openRanking} style={{background:"#1a1a2e",color:"#e8c840",border:"1px solid #e8c840",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>
                🏅 Ver Ranking
              </button>
            </div>
          </div>

        </div>
      </div></div></div>
    );
  }

  const cur = SCENES[scene];
  const canDrink = !!cur.canDrink;
  const SCENE_ORDER = (() => {
    const currentDay = days + 1;
    // Dia 1: base sem os novos ambientes
    const order = ["praca","identidade","editoria","corredor","banheiro","calango","externo","jornalismo"];
    if(currentDay >= 2) order.push("videografismo"); // Switcher
    if(currentDay >= 3) order.push("ambulatorio");   // Ambulatório
    if(currentDay >= 4) order.push("estudio");       // Estúdio
    if(cvtAvailable)    order.push("cvt");           // CVT (via chave secreta)
    return order;
  })();
  const allActions = (cur.actions||[]).filter(a=>a.special!=="voltinha_pos"||(calangoPassed&&!isExhausted("voltinha_calango")));
  const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)]||"--";
  const hasLocks = Object.values(locks).some(v=>v>0);
  const isClickScene = !!cur.clickZones;

  // Estilo dos botões do minigame do Thutti
  const btnThutti = (bg, color, border) => ({
    background:bg, color, border:`1px solid ${border||bg}`,
    padding:"10px 20px", borderRadius:8, cursor:"pointer",
    fontSize:13, fontFamily:"monospace", fontWeight:"bold", letterSpacing:1,
  });

  // Dado branco com bolinhas pretas (SVG), face = 1..6
  const ThuttiDado = ({ face, size=84 }) => {
    // posições das bolinhas numa grade 3x3 (coordenadas em % do dado)
    const P = { tl:[28,28], tr:[72,28], ml:[28,50], mr:[72,50], c:[50,50], bl:[28,72], br:[72,72] };
    const faces = {
      1:["c"], 2:["tl","br"], 3:["tl","c","br"],
      4:["tl","tr","bl","br"], 5:["tl","tr","c","bl","br"], 6:["tl","tr","ml","mr","bl","br"],
    };
    const pips = faces[face]||[];
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" style={{filter:"drop-shadow(0 4px 8px rgba(0,0,0,.5))"}}>
        <rect x="4" y="4" width="92" height="92" rx="16" fill="#ffffff" stroke="#d0d0d0" strokeWidth="2"/>
        {pips.map((k,i)=>{ const [cx,cy]=P[k]; return <circle key={i} cx={cx} cy={cy} r="8" fill="#1a1a1a"/>; })}
      </svg>
    );
  };

  return (
    <div style={OUTER}>
    <div style={INNER}>
    <div style={W}>

      {/* ÁUDIO DE FUNDO */}
      <audio ref={audioRef} src={MUSIC_MAIN} loop preload="auto"/>

      {/* KEYFRAMES GLOBAIS */}
      <style>{`
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes statfloat{0%{transform:translateY(0);opacity:0}12%{opacity:1}70%{opacity:1}100%{transform:translateY(-20px);opacity:0}}
        @keyframes statshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}}
        @keyframes dangerglow{0%,100%{box-shadow:0 0 3px #ff444433}50%{box-shadow:0 0 10px #ff4444aa}}
        @keyframes vignettepulse{0%,100%{opacity:.55}50%{opacity:1}}
        @keyframes dayintro{0%{opacity:0;transform:scale(.7)}12%{opacity:1;transform:scale(1.05)}20%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(1.04)}}
        @keyframes clockpulse{0%{transform:scale(1);color:#e8c840}40%{transform:scale(1.3);color:#fff}100%{transform:scale(1)}}
      `}</style>

      {/* TRANSIÇÃO DE DIA — "DIA X" */}
      {dayIntro&&(
        <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:960,display:"flex",alignItems:"center",justifyContent:"center",background:"radial-gradient(ellipse at center, rgba(0,0,0,.55), rgba(0,0,0,.75))",animation:"dayintro 2s ease forwards"}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:12,letterSpacing:8,color:"#8888aa",fontFamily:"monospace",marginBottom:6}}>EXPEDIENTE</div>
            <div style={{fontSize:72,fontWeight:900,fontFamily:"'Arial Black',Arial,sans-serif",color:"#e8c840",letterSpacing:4,textShadow:"0 0 40px rgba(232,200,64,.5), 0 4px 0 #7a6410"}}>
              DIA {dayIntro}
            </div>
            <div style={{fontSize:11,color:"#666",fontFamily:"monospace",marginTop:8}}>Bata o ponto e sobreviva.</div>
          </div>
        </div>
      )}

      {/* VINHETA DE PERIGO — bordas vermelhas pulsando quando alguma barra está crítica */}
      {(stats.criar<=DANGER||stats.socializar<=DANGER||stats.mexer<=DANGER||agua<=DANGER)&&(
        <div style={{
          position:"absolute",inset:0,pointerEvents:"none",zIndex:950,
          boxShadow:"inset 0 0 110px 26px rgba(255,30,30,.22)",
          animation:"vignettepulse 1.2s ease infinite",
        }}/>
      )}

      {/* CRITICAL MODAL */}
      {critModal&&(
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.87)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}}>
          <div style={{background:"#100000",border:"2px solid #ff4444",borderRadius:14,padding:"28px 32px",maxWidth:400,textAlign:"center",boxShadow:"0 0 60px #ff444433"}}>
            <div style={{fontSize:48,marginBottom:8}}>{critModal.emoji}</div>
            <div style={{fontSize:12,color:"#ff4444",fontWeight:"bold",marginBottom:6,letterSpacing:2,fontFamily:"monospace",textTransform:"uppercase"}}>Evento Crítico!</div>
            <div style={{fontSize:14,color:"#e8c840",fontWeight:"bold",marginBottom:10,fontFamily:"monospace"}}>{critModal.title}</div>
            <div style={{fontSize:12,color:"#ccc",lineHeight:1.8,marginBottom:14,fontFamily:"sans-serif"}}>{critModal.msg}</div>
            <div style={{background:"#1a0000",border:"1px solid #ff444455",borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:11,color:"#f59e0b",fontFamily:"monospace",lineHeight:1.7}}>
              {critModal.type==="lock"&&<>
                ⏳ <strong>{critModal.category==="criar"?"Criatividade":critModal.category==="mexer"?"Movimentação":"Socialização"}</strong> bloqueada globalmente<br/>por {critModal.turns} turno{critModal.turns!==1?"s":""} ({critModal.turns*15}min)
              </>}
              {critModal.type==="lock_multi"&&<>
                ⏳ <strong>{critModal.categories.map(c=>c==="criar"?"Criatividade":c==="mexer"?"Movimentação":"Socialização").join(" e ")}</strong> bloqueadas globalmente<br/>por {critModal.turns} turno{critModal.turns!==1?"s":""} ({critModal.turns*15}min)
              </>}
              {critModal.type==="set_stat"&&critModal.stat==="agua"&&<>
                💧 <strong>Hidratação</strong> foi para {critModal.value}%
              </>}
              {critModal.type==="set_stat"&&critModal.stat==="socializar"&&<>
                💬 <strong>Socialização</strong> foi para {critModal.value}%
              </>}
            </div>
            <button onClick={()=>setCritModal(null)} style={{background:"#ff4444",color:"#fff",border:"none",padding:"9px 26px",borderRadius:6,cursor:"pointer",fontFamily:"monospace",fontSize:12,fontWeight:"bold",letterSpacing:1}}>ENTENDIDO</button>
          </div>
        </div>
      )}

      {/* INFO MODAL (avisos — azul claro) */}
      {infoModal&&(
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,animation:"fadeIn .2s ease"}}>
          <div style={{background:"linear-gradient(160deg,#0a2540,#0e3050)",border:"2px solid #38bdf8",borderRadius:14,padding:"28px 32px",maxWidth:400,textAlign:"center",boxShadow:"0 0 60px #38bdf855",animation:"popIn .25s ease"}}>
            <div style={{fontSize:48,marginBottom:8}}>{infoModal.emoji}</div>
            <div style={{fontSize:12,color:"#7dd3fc",fontWeight:"bold",marginBottom:6,letterSpacing:2,fontFamily:"monospace",textTransform:"uppercase"}}>Aviso</div>
            <div style={{fontSize:15,color:"#e0f2fe",fontWeight:"bold",marginBottom:10,fontFamily:"monospace"}}>{infoModal.title}</div>
            <div style={{fontSize:12,color:"#bae6fd",lineHeight:1.8,marginBottom:18,fontFamily:"sans-serif",whiteSpace:"pre-line"}}>{infoModal.msg}</div>
            <button onClick={()=>setInfoModal(null)} style={{background:"#38bdf8",color:"#04253d",border:"none",padding:"9px 26px",borderRadius:6,cursor:"pointer",fontFamily:"monospace",fontSize:12,fontWeight:"bold",letterSpacing:1}}>ENTENDIDO</button>
          </div>
        </div>
      )}

      {/* MINIGAME RODA A RODA (Estúdio) */}
      {rodaOpen&&(
        <RodaARoda playerName={name||"Você"} onReward={rodaReward} onClose={rodaClose}/>
      )}

      {/* MINIGAME FUTEBOL DA CRIAÇÃO VISUAL */}
      {futebolOpen&&(
        <FutebolCriacaoVisual playerName={name||"Você"} onReward={futebolReward} onClose={futebolClose}/>
      )}

      {/* MINIGAME DO THUTTI — pop-up 80% */}
      {thuttiGame&&(
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,animation:"fadeIn .2s ease"}}>
          <div style={{
            width:"80%",height:"80%",
            background:"radial-gradient(ellipse at center,#1a6b3a,#0d3d20)",
            border:"4px solid #5a3a1a",borderRadius:16,
            boxShadow:"0 0 80px rgba(0,0,0,.8), inset 0 0 60px rgba(0,0,0,.4)",
            display:"flex",flexDirection:"column",alignItems:"center",
            padding:"30px",boxSizing:"border-box",fontFamily:"monospace",position:"relative",
          }}>
            {/* Rosto do Thutti — canto superior direito */}
            <div style={{position:"absolute",top:30,right:30,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
              <img src="https://res.cloudinary.com/dio7kf0tb/image/upload/v1783555874/thutti_thumb_sntw5f.png"
                alt="Thutti" style={{width:64,height:64,objectFit:"contain",filter:"drop-shadow(0 3px 6px rgba(0,0,0,.5))"}}/>
              <div style={{fontSize:9,color:"#ffe08a",fontWeight:"bold",letterSpacing:1}}>THUTTI</div>
            </div>

            {/* Cabeçalho */}
            <div style={{textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:18,color:"#ffe08a",fontWeight:"bold",letterSpacing:2,textShadow:"0 2px 4px rgba(0,0,0,.6)"}}>🎲 21 DO THUTTI 🃏</div>
              <div style={{fontSize:10,color:"#bfe8cf",marginTop:3}}>Chegue o mais perto de 21 sem estourar. Role o dado, depois compre.</div>
            </div>

            {/* Total atual */}
            <div style={{margin:"8px 0",flexShrink:0,textAlign:"center"}}>
              <div style={{fontSize:11,color:"#bfe8cf",letterSpacing:1}}>SEU TOTAL</div>
              <div style={{fontSize:42,fontWeight:"bold",lineHeight:1,color:thuttiGame.total>21?"#ff6b6b":thuttiGame.total===21?"#ffe08a":"#fff",textShadow:"0 2px 6px rgba(0,0,0,.6)"}}>{thuttiGame.total}</div>
            </div>

            {/* Centro da mesa: dado grande */}
            <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,width:"100%"}}>
              {thuttiGame.dado&&thuttiGame.fase==="comprar"
                ? (
                  <>
                    <ThuttiDado face={thuttiGame.dado} size={90}/>
                    <div style={{fontSize:11,fontWeight:"bold",textAlign:"center",color:thuttiGame.dado>=5?"#ff9b6b":thuttiGame.dado<=2?"#6bb6ff":"#ffe08a"}}>
                      {thuttiGame.dado>=5?"ARRISCADO — próxima carta +3":thuttiGame.dado<=2?"SEGURO — próxima carta vale metade":"NORMAL — carta vale o valor cheio"}
                    </div>
                  </>
                )
                : thuttiGame.fase==="rolar"
                ? <div style={{opacity:.4}}><ThuttiDado face={1} size={90}/></div>
                : null
              }

              {/* Cartas compradas */}
              <div style={{display:"flex",flexWrap:"wrap",gap:8,alignContent:"flex-start",justifyContent:"center",maxWidth:"100%",overflowY:"auto",padding:"4px 0"}}>
                {thuttiGame.cards.map((c,i)=>{
                  const vermelho = c.naipe==="♥"||c.naipe==="♦";
                  const efeito = c.mod==="+3" ? "+3" : c.mod==="½" ? `÷2 = ${c.val}` : null;
                  return (
                    <div key={i} style={{
                      width:62,height:88,background:"#fff",borderRadius:8,
                      border:"2px solid #333",position:"relative",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      boxShadow:"0 3px 6px rgba(0,0,0,.4)",animation:"popIn .2s ease",
                    }}>
                      {/* naipe canto superior esquerdo */}
                      <div style={{position:"absolute",top:3,left:5,fontSize:11,color:vermelho?"#c0392b":"#222",lineHeight:1}}>{c.naipe}</div>
                      {/* naipe canto inferior direito (invertido) */}
                      <div style={{position:"absolute",bottom:3,right:5,fontSize:11,color:vermelho?"#c0392b":"#222",lineHeight:1,transform:"rotate(180deg)"}}>{c.naipe}</div>
                      {/* valor real sorteado */}
                      <div style={{fontSize:28,fontWeight:"bold",color:vermelho?"#c0392b":"#222",lineHeight:1}}>{c.raw}</div>
                      {/* efeito do dado embaixo */}
                      {efeito&&<div style={{fontSize:9,color:c.mod==="+3"?"#c0392b":"#2980b9",fontWeight:"bold",marginTop:2}}>{efeito}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Controles */}
            <div style={{flexShrink:0,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:10,marginTop:8}}>
              {thuttiGame.fase==="rolar"&&(
                <div style={{display:"flex",gap:10}}>
                  <button onClick={thuttiRolar} style={btnThutti("#e8c840","#000")}>🎲 Rolar o dado</button>
                  {thuttiGame.cards.length>0&&<button onClick={thuttiParar} style={btnThutti("#1a1a2e","#fff","#888")}>✋ Parar</button>}
                </div>
              )}
              {thuttiGame.fase==="comprar"&&(
                <div style={{display:"flex",gap:10}}>
                  <button onClick={thuttiComprar} style={btnThutti("#e8c840","#000")}>🃏 Comprar carta</button>
                  <button onClick={thuttiParar} style={btnThutti("#1a1a2e","#fff","#888")}>✋ Parar</button>
                </div>
              )}
              {thuttiGame.fase==="fim"&&(
                <div style={{textAlign:"center",animation:"popIn .25s ease"}}>
                  <div style={{fontSize:16,fontWeight:"bold",marginBottom:4,color:
                    thuttiGame.resultado==="perfeito"?"#ffe08a":
                    thuttiGame.resultado==="estourou"?"#ff6b6b":"#9fe8b3"}}>
                    {thuttiGame.resultado==="perfeito"?"🏆 21 CRAVADO!":
                     thuttiGame.resultado==="bom"?"👏 Boa mão!":
                     thuttiGame.resultado==="fraco"?"🙂 Jogou seguro":"💥 Estourou!"}
                  </div>
                  <button onClick={thuttiFinalizar} style={btnThutti("#22c55e","#04250f")}>Sair da mesa →</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>

        {/* ── HEADER ── */}
        <div style={{background:"#070710",borderBottom:"2px solid #1a1a2e",padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexShrink:0,height:44}}>

          {/* Logo topo jogo */}
          <div style={{display:"flex",alignItems:"center",flexShrink:0}}>
            <img
              src="https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908844/logo_top_covb4g.png"
              alt="SBT Criação Visual"
              style={{height:32,width:"auto",display:"block"}}
            />
          </div>

          {/* Locks + Música */}
          <div style={{display:"flex",alignItems:"center",gap:16,flexShrink:0}}>
            {hasLocks&&<div style={{display:"flex",gap:12}}>
              {Object.entries(locks).filter(([,v])=>v>0).map(([k,v])=>(
                <div key={k} style={{fontSize:9,color:"#ff6666",fontFamily:"monospace"}}>
                  🔒 {k==="criar"?"Criatividade":k==="mexer"?"Movimentação":"Socialização"} — {v}t
                </div>
              ))}
            </div>}
            {/* Controles de música */}
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>setMusicOn(p=>!p)}
                style={{background:"none",border:"1px solid #2a2a4a",borderRadius:6,padding:"2px 8px",cursor:"pointer",fontSize:13,color:musicOn?"#e8c840":"#444",fontFamily:"monospace",lineHeight:1,transition:"all .2s"}}
                title={musicOn?"Pausar música":"Tocar música"}>
                {musicOn?"🔊":"🔇"}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={volume}
                onChange={e=>setVolume(Number(e.target.value))}
                title="Volume"
                style={{width:60,accentColor:"#e8c840",cursor:"pointer",opacity:musicOn?1:0.3}}/>
            </div>
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* ── COLUNA ESQUERDA ── */}
          <div style={{display:"flex",flexDirection:"column",width:"780px",flexShrink:0,overflow:"hidden"}}>

            {/* NAV — modular, quebra em múltiplas linhas conforme o nº de ambientes */}
            {(()=>{
              // Quantos itens por linha: até 6 → 1 linha; 7-12 → 2 linhas equilibradas
              const total = SCENE_ORDER.length;
              const perRow = total <= 6 ? total : Math.ceil(total / 2);
              const basisPct = 100 / perRow;
              return (
                <div style={{padding:"5px 8px",background:"#080814",borderBottom:"1px solid #151525",display:"flex",flexWrap:"wrap",gap:4,flexShrink:0,width:"100%",boxSizing:"border-box"}}>
                  {SCENE_ORDER.map(sid=>{
                    const s=SCENES[sid];
                    const active=scene===sid;
                    return (
                      <button key={sid} onClick={()=>{ setScene(sid); setHotspot(null); setNpcMsg(null); setOpenZone(null); if(musicOn) sfx("click", volume); }}
                        style={{
                          flexGrow:1, flexBasis:`calc(${basisPct}% - 4px)`, minWidth:0,
                          padding:"6px 4px",
                          background:active?"#e8c840":"#111",
                          color:active?"#000":"#666",
                          border:`1px solid ${active?"#e8c840":"#1e1e2e"}`,
                          borderRadius:5, cursor:"pointer", fontSize:10, fontFamily:"monospace",
                          fontWeight:active?"bold":"normal",
                          boxShadow:active?"0 0 12px rgba(232,200,64,.55), inset 0 1px 0 rgba(255,255,255,.4)":"none",
                          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", textAlign:"center",
                          transition:"all .15s",
                        }}>
                        {s.emoji} {SCENE_NAV_LABELS[sid]}
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── CENA 780×400 ── */}
            <div style={{position:"relative",width:"780px",height:"400px",flexShrink:0,overflow:"hidden",cursor:"default"}}
              onClick={()=>{ if(openZone) setOpenZone(null); }}>

              {cur.bgImage
                ? <img src={cur.bgImage} alt={cur.name} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
                : <div style={{position:"absolute",inset:0,background:cur.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
                    <div style={{fontSize:60}}>{cur.emoji}</div>
                    <div style={{color:"#2a2a3a",fontSize:11}}>[ foto do ambiente aqui ]</div>
                  </div>
              }

              {/* Hotspots descritivos */}
              {!isClickScene && (cur.hotspots||[]).map(h=>(
                <button key={h.id} onClick={e=>{e.stopPropagation();setHotspot(hotspot?.id===h.id?null:h);setNpcMsg(null);}}
                  style={{position:"absolute",left:`${h.x}%`,top:`${h.y}%`,transform:"translate(-50%,-50%)",background:hotspot?.id===h.id?"rgba(232,200,64,.95)":"rgba(0,0,0,.75)",border:`2px solid ${hotspot?.id===h.id?"#e8c840":"rgba(255,255,255,.15)"}`,borderRadius:"50%",width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",zIndex:10,transition:"all .2s"}}>
                  {h.emoji}
                </button>
              ))}

              {/* NPCs */}
              {!isClickScene&&(cur.npcs||[]).map((nid,ni)=>{
                const npc=NPCS[nid]; if(!npc) return null;
                const positions=[{l:"75%",t:"40%"},{l:"60%",t:"38%"},{l:"85%",t:"42%"}];
                const pos=positions[ni]||positions[0];
                return (
                  <button key={nid} onClick={e=>{e.stopPropagation();setNpcMsg(npcMsg?.npc.id===nid?null:{npc,line:npc.idle});setHotspot(null);}}
                    style={{position:"absolute",left:pos.l,top:pos.t,transform:"translate(-50%,-50%)",background:"rgba(0,0,0,.85)",border:"2px solid #a855f7",borderRadius:"50%",width:34,height:34,cursor:"pointer",fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",zIndex:11,boxShadow:"0 0 8px #a855f755"}}>
                    {npc.emoji}
                  </button>
                );
              })}

              {/* Overlay info */}
              {!isClickScene&&(hotspot||npcMsg)&&(
                <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,.94)",padding:"8px 14px",borderTop:"1px solid #e8c840",fontSize:11,color:"#ddd",lineHeight:1.5,zIndex:20}}>
                  {hotspot&&<><strong style={{color:"#e8c840"}}>{hotspot.emoji} {hotspot.label}</strong><br/>{hotspot.desc}</>}
                  {npcMsg&&!hotspot&&<><strong style={{color:"#a855f7"}}>{npcMsg.npc.emoji} {npcMsg.npc.name}</strong><span style={{color:"#555",fontSize:10}}> — {npcMsg.npc.role}</span><br/><em style={{color:"#ccc"}}>{npcMsg.line}</em></>}
                </div>
              )}

              {/* Click zones (Identidade Visual) — point & click */}
              {isClickScene&&(cur.clickZones||[]).map(zone=>{
                const isOpen = openZone?.id===zone.id;
                const currentDay = days+1;

                const handleZoneClick = (e) => {
                  e.stopPropagation();
                  if(musicOn) sfx("click", volume);
                  // Zona de beber água — ação direta
                  if(zone.type==="drink"){
                    if(garrafa<=0){
                      setZonaMsg({text:"🪣 Garrafa vazia! Encha no corredor.", zona:zone.id});
                      setOpenZone(null);
                      return;
                    }
                    drinkWater();
                    setZonaMsg({text:"💧 Você bebeu água!", zona:zone.id});
                    setOpenZone(null);
                    return;
                  }
                  // Zona de famoso — só ativa se há famoso disponível
                  if(zone.type==="famoso"){
                    if(!famosoAtual||famosoUsado) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Coco Mágico: só clicável quando visível; abre menu com fala+ação
                  if(zone.type==="coco"){
                    if(!cocoVisible) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // SARA: só clicável quando visível; abre menu com fala+ação
                  if(zone.type==="sara"){
                    if(!saraVisible) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Personagem da Área Externa: só clicável quando há personagem hoje
                  if(zone.type==="extchar"){
                    if(!extChar) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Vera Verão: só clicável quando visível
                  if(zone.type==="vera"){
                    if(!veraVisible) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Loira do Banheiro: só clicável depois de chamada e antes de usar a ajuda
                  if(zone.type==="loira"){
                    if(!loiraChamada || usedOnce["pedir_loira"]) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Comida do dia (ID Visual): sempre presente
                  if(zone.type==="comida"){
                    if(!comidaHoje) return;
                    if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                    else { setOpenZone(zone); setZonaMsg(null); }
                    return;
                  }
                  // Zona só de falas
                  if(zone.type==="fala"){
                    const dispFalas = zone.falas.filter(f=>currentDay>=f.minDay);
                    if(dispFalas.length>0){
                      const f = dispFalas[Math.floor(Math.random()*dispFalas.length)];
                      setZonaMsg({text:`${zone.emoji} "${f.text}"`, zona:zone.id});
                    }
                    setOpenZone(null);
                    return;
                  }
                  // Zona fala+chave (Estante do Jornalismo): mostra fala; se a chave estiver
                  // disponível (dia 4+ e ainda não pega), abre o menu da chave
                  if(zone.type==="fala+chave"){
                    const chaveAvail = (currentDay>=4) && !cvtUnlocked && !cvtAvailable;
                    if(chaveAvail){
                      if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                      else { setOpenZone(zone); setZonaMsg(null); }
                    } else {
                      const dispFalas = zone.falas.filter(f=>currentDay>=f.minDay);
                      if(dispFalas.length>0){
                        const f = dispFalas[Math.floor(Math.random()*dispFalas.length)];
                        setZonaMsg({text:`${zone.emoji} "${f.text}"`, zona:zone.id});
                      }
                      setOpenZone(null);
                    }
                    return;
                  }
                  // Zona de ação ou action+fala ou action+dia — toggle menu
                  if(zone.type==="action+dia" && zoneDiaDisabled){ setZonaMsg({text:"⛔ Fechado a partir do 3º dia.", zona:zone.id}); return; }
                  if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                  else { setOpenZone(zone); setZonaMsg(null); }
                };

                // Zona de famoso: só renderiza se há famoso disponível e não foi usado
                if(zone.type==="famoso" && (!famosoAtual || famosoUsado)) return null;

                // Zona do Coco Mágico: só renderiza quando visível
                if(zone.type==="coco" && !cocoVisible) return null;

                // Zona da SARA: só renderiza quando visível
                if(zone.type==="sara" && !saraVisible) return null;
                if(zone.type==="extchar" && !extChar) return null;
                if(zone.type==="vera" && !veraVisible) return null;
                if(zone.type==="loira" && (!loiraChamada || usedOnce["pedir_loira"])) return null;
                if(zone.type==="comida" && !comidaHoje) return null;

                // Zona action+dia: não renderiza a partir do maxDay
                const zoneDiaDisabled = zone.type==="action+dia" && zone.maxDay && currentDay > zone.maxDay;

                return (
                  <div key={zone.id}>
                    {/* Imagem do famoso (PNG transparente) sobreposta na zona */}
                    {zone.type==="famoso" && famosoAtual && !famosoUsado && (
                      <img
                        src={famosoAtual.img}
                        alt={famosoAtual.nome}
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem do Coco Mágico (PNG transparente) */}
                    {zone.type==="coco" && cocoVisible && (
                      <img
                        src={zone.img}
                        alt="Coco Mágico"
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem da SARA (PNG transparente) */}
                    {zone.type==="sara" && saraVisible && (
                      <img
                        src={zone.img}
                        alt="SARA"
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"center",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem do personagem da Área Externa (posição/img vêm do extChar) */}
                    {zone.type==="extchar" && extChar && (
                      <img
                        src={extChar.img}
                        alt={extChar.nome}
                        style={{
                          position:"absolute",
                          left:`${extChar.x}%`, top:`${extChar.y}%`,
                          width:`${extChar.w}%`, height:`${extChar.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem da Vera Verão (PNG transparente) */}
                    {zone.type==="vera" && veraVisible && (
                      <img
                        src={zone.img}
                        alt="Vera Verão"
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem da Loira do Banheiro (PNG transparente) */}
                    {zone.type==="loira" && loiraChamada && !usedOnce["pedir_loira"] && (
                      <img
                        src={zone.img}
                        alt="Loira do Banheiro"
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Imagem da comida do dia (PNG transparente) */}
                    {zone.type==="comida" && comidaHoje && (
                      <img
                        src={comidaHoje.img}
                        alt={comidaHoje.nome}
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"contain", objectPosition:"bottom",
                          zIndex:12, pointerEvents:"none",
                        }}
                      />
                    )}
                    {/* Overlay de fechado para zonas action+dia desativadas */}
                    {zoneDiaDisabled && (
                      <div style={{
                        position:"absolute",
                        left:`${zone.x}%`, top:`${zone.y}%`,
                        width:`${zone.w}%`, height:`${zone.h}%`,
                        background:"rgba(0,0,0,.55)",
                        zIndex:13, borderRadius:4, cursor:"pointer",
                        display:"flex", alignItems:"center", justifyContent:"center",
                      }}
                      onClick={e=>{e.stopPropagation();setZonaMsg({text:"⛔ Fechado a partir do 3º dia.", zona:zone.id});}}
                      >
                        <span style={{fontSize:18}}>⛔</span>
                      </div>
                    )}
                    {/* Área de clique — highlight no hover (exceto água, famoso, coco, sara, extchar que têm visual próprio) */}
                    {(()=>{
                      // Para extchar, a área de clique segue a posição/tamanho do personagem do dia
                      const zx = zone.type==="extchar"&&extChar ? extChar.x : zone.x;
                      const zy = zone.type==="extchar"&&extChar ? extChar.y : zone.y;
                      const zw = zone.type==="extchar"&&extChar ? extChar.w : zone.w;
                      const zh = zone.type==="extchar"&&extChar ? extChar.h : zone.h;
                      const noHl = zone.type==="drink"||zone.type==="famoso"||zone.type==="coco"||zone.type==="sara"||zone.type==="extchar"||zone.type==="vera"||zone.type==="loira"||zone.type==="comida";
                      return (
                        <div
                          onClick={handleZoneClick}
                          style={{
                            position:"absolute",
                            left:`${zx}%`, top:`${zy}%`,
                            width:`${zw}%`, height:`${zh}%`,
                            cursor:"pointer",
                            border:(isOpen&&!noHl)?"2px solid #e8c840":"2px solid transparent",
                            borderRadius:6,
                            background:(isOpen&&!noHl)?"rgba(232,200,64,.12)":"transparent",
                            transition:"all .2s", zIndex:15,
                          }}
                          onMouseEnter={e=>{if(!isOpen&&!zoneDiaDisabled&&!noHl){e.currentTarget.style.border="2px solid rgba(232,200,64,.4)";e.currentTarget.style.background="rgba(232,200,64,.06)";}}}
                          onMouseLeave={e=>{if(!isOpen){e.currentTarget.style.border="2px solid transparent";e.currentTarget.style.background="transparent";}}}
                        />
                      );
                    })()}
                    {/* Menu de ações para zonas do tipo action / action+fala / famoso / coco / sara / extchar */}
                    {isOpen&&(zone.type==="action"||zone.type==="action+fala"||zone.type==="action+dia"||zone.type==="fala+chave"||zone.type==="famoso"||zone.type==="coco"||zone.type==="sara"||zone.type==="extchar"||zone.type==="vera"||zone.type==="loira"||zone.type==="comida")&&!zoneDiaDisabled&&(()=>{
                      // Para extchar, usa os dados do personagem do dia (actionIds, falas, posição do menu)
                      const effZone = zone.type==="extchar"&&extChar
                        ? { ...zone, ...extChar, label:extChar.nome, menuSide: (extChar.x + extChar.w/2)>50?"left":undefined }
                        : zone.type==="vera"
                        ? { ...zone, menuSide:"left" }
                        : zone.type==="loira"
                        ? { ...zone, menuSide:"left" }
                        : zone.type==="comida"
                        ? { ...zone, menuSide:"left" }
                        : zone;
                      let zoneActions = cur.actions.filter(a=>
                        (effZone.actionIds||[]).includes(a.id) &&
                        !(a.availDay && (days+1) < a.availDay) &&            // oculta ações ainda não liberadas por dia
                        !(a.special==="voltinha_pos" && !calangoPassed) &&    // oculta voltinha pós-calango até passar no teste
                        !(a.special==="thutti" && !calangoPassed) &&          // oculta Thutti até passar no Calango
                        !(a.special==="chamar_loira" && (!descargasFeitas || loiraChamada)) && // Loira: só após as descargas, some depois de chamada
                        !(a.special==="reservar_quadra" && (quadraReservada || futebolUsado)) && // Reservar: some após reservar/jogar
                        !(a.special==="futebol" && (!quadraReservada || futebolUsado))       // Futebol: só após reservar, some após jogar
                      );
                      // Zona de famoso: label dinâmico com o nome do famoso atual
                      if(zone.type==="famoso" && famosoAtual){
                        zoneActions = zoneActions.map(a=>
                          a.id==="foto_famoso"
                            ? {...a, label:`Tirar foto com ${famosoAtual.nome}`, emoji:famosoAtual.emoji}
                            : a
                        );
                      }
                      // Zona de comida: label dinâmico com o nome da comida do dia
                      if(zone.type==="comida" && comidaHoje){
                        zoneActions = zoneActions.map(a=>
                          a.id==="comer_comida"
                            ? {...a, label:`${comidaHoje.verbo||"Comer"} ${comidaHoje.nome}`}
                            : a
                        );
                      }
                      // Se action+fala, coco, sara ou extchar: ao clicar numa ação mostra uma fala aleatória também
                      const onZoneAction = (a) => {
                        if((zone.type==="action+fala"||zone.type==="coco"||zone.type==="sara"||zone.type==="extchar"||zone.type==="vera"||zone.type==="loira")&&effZone.falas){
                          // Se a fala tem actionId, filtra só as da ação executada; senão, todas
                          const dispFalas=effZone.falas.filter(f=>
                            currentDay>=f.minDay &&
                            (f.actionId===undefined || f.actionId===a.id)
                          );
                          if(dispFalas.length>0){
                            const f=dispFalas[Math.floor(Math.random()*dispFalas.length)];
                            setZonaMsg({text:`${effZone.emoji||"⭐"} "${f.text}"`, zona:zone.id});
                          }
                        }
                        doAction(a);
                      };
                      return <ActionMenu zone={effZone} actions={zoneActions} locks={locks} shiftCfg={shiftCfg} turn={turn} usageCounts={usageCounts} getLimit={getLimit} days={days} usedOnce={usedOnce} onAction={onZoneAction} onClose={()=>{setOpenZone(null);setZonaMsg(null);}}/>;
                    })()}
                  </div>
                );
              })}

              {/* Label */}
              <div style={{position:"absolute",top:7,left:10,background:"rgba(0,0,0,.75)",padding:"3px 10px",borderRadius:4,fontSize:10,color:"#e8c840",letterSpacing:1,fontFamily:"monospace",zIndex:5}}>{cur.emoji} {cur.name}</div>

              {/* Botão água — Editoria (não ID Visual) */}
              {canDrink&&!isClickScene&&(
                <button onClick={drinkWater}
                  style={{position:"absolute",top:7,right:10,background:garrafa>0?"#0ea5e9":"#444",color:"#fff",border:`1px solid ${garrafa>0?"#38bdf8":"#666"}`,borderRadius:20,padding:"4px 12px",fontSize:11,cursor:garrafa>0?"pointer":"not-allowed",fontFamily:"monospace",fontWeight:"bold",zIndex:20}}>
                  💧 Beber água {garrafa<=0?"(vazia)":""}
                </button>
              )}
            </div>

            {/* ── AÇÕES (cenas não-ID-Visual) ── */}
            {!isClickScene&&(
              <div style={{padding:"7px 10px",background:"#080814",flex:1,overflowY:"auto"}}>
                <div style={{fontSize:8,color:"#444",letterSpacing:2,marginBottom:5,textTransform:"uppercase"}}>Ações — {cur.name}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5}}>
                  {allActions.map(a=>{
                    const locked=isActionLocked(a.id);
                    const unavail=!isAvail(a);
                    const exhausted=isExhausted(a.id);
                    const lim=getLimit(a.id);
                    const aDisplay = (a.id==="foto_famoso"&&famosoAtual&&!famosoUsado)
                      ? {...a, label:`Foto com ${famosoAtual.nome}`, emoji:famosoAtual.emoji}
                      : a;
                    return <ActionBtn key={a.id} a={aDisplay} locked={locked} unavail={unavail} exhausted={exhausted} usageCount={usageCounts[a.id]||0} limit={lim} onAction={doAction}/>;
                  })}
                </div>
              </div>
            )}

            {/* ── PAINEL ABAIXO DA CENA (ID Visual) — falas e infos ── */}
            {isClickScene&&(
              <div style={{background:"#080814",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",borderTop:"1px solid #0f0f1e",padding:"10px 20px",gap:8}}>
                {zonaMsg
                  ? (
                    <div style={{
                      background:"#0d0d1c",border:"1px solid #e8c840",borderRadius:10,
                      padding:"14px 20px",maxWidth:"85%",textAlign:"center",
                      animation:"popIn .2s ease",
                    }}>
                      <div style={{fontSize:13,color:"#e8c840",fontFamily:"monospace",lineHeight:1.7}}>
                        {zonaMsg.text}
                      </div>
                      <button onClick={()=>setZonaMsg(null)}
                        style={{marginTop:10,background:"none",border:"1px solid #2a2a3a",borderRadius:5,color:"#444",fontSize:9,fontFamily:"monospace",padding:"3px 12px",cursor:"pointer"}}>
                        fechar
                      </button>
                    </div>
                  )
                  : (
                    <div style={{textAlign:"center",color:"#6a6a8a",fontSize:11,fontFamily:"monospace",lineHeight:1.8,userSelect:"none"}}>
                      🖱️ Clique nos objetos do cenário
                    </div>
                  )
                }
              </div>
            )}
          </div>

          {/* ── COLUNA DIREITA: status + chat ── */}
          <div style={{flex:1,background:"#0a0a16",borderLeft:"1px solid #151525",display:"flex",flexDirection:"column",overflow:"hidden"}}>

            {/* STATUS */}
            <div style={{padding:"12px 14px 8px",borderBottom:"1px solid #151525",flexShrink:0}}>
              <div style={{fontSize:12,color:"#36f118",letterSpacing:2,marginBottom:9,textTransform:"uppercase",fontWeight:"bold"}}>Status — {name}</div>
              <StatBar label="Criatividade"  emoji="🎨" value={stats.criar}      color="#5b8dee" locked={(locks.criar||0)>0}      float={statFloats.criar}/>
              <StatBar label="Socialização"  emoji="💬" value={stats.socializar} color="#a855f7" locked={(locks.socializar||0)>0} float={statFloats.socializar}/>
              <StatBar label="Movimentação"  emoji="🏃" value={stats.mexer}      color="#22c55e" locked={(locks.mexer||0)>0}      float={statFloats.mexer}/>
              <HydSection garrafa={garrafa} agua={agua} canDrinkHere={canDrink} float={statFloats.agua}/>
            </div>

            {/* LOG CHAT */}
            <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
              <div style={{padding:"5px 12px",background:"#3d7047",borderBottom:"1px solid #2d5037",flexShrink:0}}>
                <span style={{fontSize:9,color:"#c8e6c9",letterSpacing:2,textTransform:"uppercase",fontFamily:"monospace"}}>💬 Log do Dia</span>
              </div>
              <ChatLog log={log}/>
            </div>
          </div>

        </div>

        {/* ── RODAPÉ: relógio + timeline ── */}
        <div style={{background:"#070710",borderTop:"2px solid #1a1a2e",padding:"0 14px",display:"flex",alignItems:"center",gap:12,flexShrink:0,height:52}}>

          {/* Ícone analógico 30% maior */}
          <span style={{fontSize:39,flexShrink:0,lineHeight:1}}>🕐</span>

          {/* DIA fora do box + Horário digital */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,gap:1}}>
            <span style={{fontSize:12,fontWeight:"bold",color:"#36f118",fontFamily:"'Courier New',monospace",letterSpacing:2,textTransform:"uppercase",lineHeight:1}}>DIA {days+1}</span>
            <div style={{background:"#0d0d20",border:"1px solid #2a2a4a",borderRadius:8,padding:"3px 14px"}}>
              <span key={turn} style={{fontSize:20,fontWeight:"bold",color:"#fff",fontFamily:"'Courier New',monospace",letterSpacing:3,lineHeight:1,display:"inline-block",animation:"clockpulse .55s ease"}}>{lbl}</span>
            </div>
          </div>

          {/* Timeline ENTRADA → SAÍDA ocupando toda a largura restante */}
          <div style={{display:"flex",alignItems:"center",gap:6,flex:1,overflow:"hidden"}}>
            <span style={{fontSize:8,color:"#868695",fontFamily:"monospace",letterSpacing:1,textTransform:"uppercase",flexShrink:0}}>ENTRADA</span>
            <div style={{display:"flex",gap:2,alignItems:"center",flex:1,overflow:"hidden"}}>
              {Array.from({length:TOTAL_TURNS}).map((_,i)=>(
                <div key={i} title={turnLabels[i]}
                  style={{flex:1,height:14,borderRadius:3,minWidth:0,background:i<turn?"#e8c840":i===turn?"#ffffff":"#1e1e2e",transition:"background 0.3s"}}/>
              ))}
            </div>
            <span style={{fontSize:8,color:"#868695",fontFamily:"monospace",letterSpacing:1,textTransform:"uppercase",flexShrink:0}}>SAÍDA</span>
          </div>

        </div>

      </div>
    </div>
    </div>
    </div>
  );
}
