import { useState, useEffect, useRef } from "react";
 
// ── CONSTANTES ────────────────────────────────────────────────────────────────
const TOTAL_TURNS = 38;
const TURN_MIN    = 15;
const WARN = 28; const DANGER = 10;
const clamp = v => Math.max(0, Math.min(100, v));
 
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
  fazer_vinheta:1, fazer_logo:2, buscar_ref:2, pegar_tarefa:6,
  mostrar_helder:8, avisar_ferias:1,
  fazer_leds:1, fazer_ilustracao:2,
  trocar_ideia:6, papo_kell:2, meme_jess:2,
  janela_cor:1,
  fumar:6,
  lavar_rosto:10,
  sentar_mureta:2,
  fazer_laboral:1,
  cochilo:2,
  comer_calango:2,
  voltinha_calango:2,
  // Jornalismo
  pacote_grafico:1, censurar_crime:4, checar_email:4, cafe_gui:2, agua_coco:1,
};
 
// Categorias para bloqueio global por eventos críticos
const ACTION_CAT = {
  fazer_vinheta:"criar", fazer_logo:"criar", buscar_ref:"criar", pegar_tarefa:"criar",
  mostrar_helder:"socializar", avisar_ferias:"socializar", tocar_violao:null, beber_agua_id:null,
  fazer_leds:"criar", fazer_ilustracao:"criar",
  trocar_ideia:"socializar", papo_kell:"socializar", cafe_edit:"socializar", meme_jess:"socializar",
  fazer_laboral:"mexer",
  subir_escada:"mexer", encher_garr:"mexer", janela_cor:null,
  lavar_rosto:"mexer", pausa_estrategica:"mexer", cochilo:null,
  cafe_praca:"socializar", cafe_caro:"socializar", almoco_rapido:null, mesa_quieta:"mexer", foto_famoso:"socializar", ir_calango:"mexer",
  comer_calango:null, voltar_praca:"mexer", voltinha_calango:"mexer",
  voltinha:"mexer", sentar_mureta:"socializar", fumar:"mexer",
  // Jornalismo
  pacote_grafico:"criar", censurar_crime:"criar", checar_email:"criar",
  cafe_gui:"socializar", agua_coco:null,
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
};
 
// ── FAMOSOS ───────────────────────────────────────────────────────────────────
const FAMOSOS = [
  { id:"patricia", nome:"Patricia Abravanel", emoji:"👑", prob:0.25,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908848/praca_patricia_1_yaid3s.jpg",
    frase:"Nossa como você é bonito(a)!",
    effects:{criar:-40, mexer:0, socializar:+60} },
  { id:"xaropinho", nome:"Xaropinho", emoji:"🎤", prob:0.10,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908849/praca_xaropinho_2_jtap0c.jpg",
    frase:"Rapaaaaazzz",
    effects:{criar:0, mexer:0, socializar:+100} },
  { id:"celso", nome:"Celso Portiolli", emoji:"🎰", prob:0.25,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908845/praca_celso_3_amdq2u.jpg",
    frase:"É hora de arriscar!",
    effects:{criar:-40, mexer:0, socializar:+60} },
  { id:"liminha", nome:"Liminha", emoji:"🎸", prob:0.40,
    img:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908846/praca_liminha_4_jk8yfp.jpg",
    frase:"Você Sabia que o Agnaldo Timóteo foi motorista da Ângela Maria?",
    effects:{criar:-40, mexer:0, socializar:+40} },
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
 
 
const SCENE_NAV_LABELS = {
  praca:"Praça", identidade:"Id. Visual", editoria:"Editoria",
  corredor:"Corredor", banheiro:"Banheiro", calango:"Calango",
  externo:"Área Externa", jornalismo:"Jornalismo"
};
const SCENE_ORDER_BASE = ["praca","identidade","editoria","corredor","banheiro","calango","externo"];
const SCENE_ORDER_DAY2 = ["praca","identidade","editoria","corredor","banheiro","calango","externo","jornalismo"];
 
const SCENES = {
  praca:{
    id:"praca", name:"Praça de Alimentação", emoji:"🍽️",
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908844/praca_base_bumsws.jpg",
    npcs:[],
    hotspots:[],
    clickZones:[
      {
        id:"zona1", label:"Padoca", emoji:"☕",
        x:0, y:22, w:18, h:68,
        type:"action",
        actionIds:["cafe_praca"],
      },
      {
        id:"zona2", label:"Casa do Pão de Quê?", emoji:"🧆",
        x:18, y:26, w:14, h:42,
        type:"action+dia",  // indisponível a partir do dia 3
        actionIds:["cafe_caro"],
        maxDay:2,
      },
      {
        id:"zona3", label:"Ir pro Calango 🦎", emoji:"🦎",
        x:18, y:68, w:14, h:28,
        type:"action",
        actionIds:["ir_calango"],
      },
      {
        id:"zona4", label:"Mesas", emoji:"🧘",
        x:32, y:65, w:38, h:35,
        type:"action",
        actionIds:["almoco_rapido","mesa_quieta"],
      },
      {
        id:"zona5", label:"Famoso", emoji:"📸",
        x:70, y:28, w:18, h:62,
        type:"famoso",
        actionIds:["foto_famoso"],
      },
      {
        id:"zona6", label:"TV — Silvio Santos", emoji:"📺",
        x:70, y:20, w:10, h:12,
        type:"fala",
        falas:[
          { text:"Do mundo não se leva nada. Vamos sorrir e cantar!", minDay:1 },
          { text:"Se ganha dinheiro com 10% de inspiração e 90% de transpiração", minDay:1 },
          { text:"Vai pra lá, vai pra lá!", minDay:1 },
          { text:"É você que é o ES-QUE-LE-TO?", minDay:4 },
        ],
      },
    ],
    actions:[
      {id:"cafe_praca",    label:"Tomar um café",                      emoji:"☕", time:1, effects:{criar:+5, mexer:0,   socializar:+5},  msg:"Café da praça. Fraco mas quente. Funciona."},
      {id:"cafe_caro",     label:"Tomar um café só que mais caro",               emoji:"☕", time:1, effects:{criar:+5, mexer:0,   socializar:+5},  msg:"Café especial. Caro. Mas admita: o copo era bonito."},
      {id:"almoco_rapido", label:"Almoço rápido (cheio e barulhento)", emoji:"🍱", time:2, effects:{criar:0,  mexer:+20, socializar:+50}, availFrom:"11:30", availUntil:"15:30", msg:"Você almoçou com 200 pessoas gritando. A comida estava ok. Seus ouvidos, não."},
      {id:"mesa_quieta",   label:"Achar uma mesa pra sentar",          emoji:"🧘", time:4, effects:{criar:0,  mexer:+30, socializar:+30}, availFrom:"11:30", availUntil:"15:30", msg:"Você achou um cantinho tranquilo. Comeu devagar. Isso deveria ser mais comum."},
      {id:"foto_famoso",   label:"Tirar foto com famoso",              emoji:"📸", time:2, special:"foto_famoso", effects:{}, msg:""},
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
        x:0, y:37, w:17, h:55,
        type:"fala",
        falas:[
          { text:"Vai lá Brasil!", minDay:1 },
          { text:"O quê você tá procurando? Não vai me sequestrar não né?", minDay:1 },
          { text:"Se me falar que eu pareço com a Betinha te arrebento!", minDay:3 },
        ],
      },
      {
        id:"zona2", label:"Hélder", emoji:"👨‍💼",
        x:17, y:37, w:20, h:50,
        type:"action+fala",
        actionIds:["mostrar_helder","avisar_ferias"],
        falas:[
          { text:"Muito bom, pode mandar bala", minDay:1, actionId:"mostrar_helder" },
          { text:"É que na verdadeeee euuu, gostaria de dizzzeerrr queee...", minDay:1, actionId:"mostrar_helder" },
          { text:"Vai viajar pra onde?", minDay:1, actionId:"avisar_ferias" },
          { text:"Não vai ficar fazendo freela nas férias hein?", minDay:1, actionId:"avisar_ferias" },
        ],
      },
      {
        id:"zona3", label:"Violão", emoji:"🎸",
        x:43, y:42, w:13, h:45,
        type:"action",
        actionIds:["tocar_violao"],
      },
      {
        id:"zona4", label:"Robô", emoji:"🤖",
        x:67, y:42, w:8, h:30,
        type:"fala",
        falas:[
          { text:"Instalou seus plugins BRP?", minDay:1 },
          { text:"Se precisar eu crio um script pra você", minDay:1 },
          { text:"Por favor, não me ofereça mais Monsters", minDay:3 },
        ],
      },
      {
        id:"zona5", label:"Monitores", emoji:"💻",
        x:75, y:30, w:22, h:55,
        type:"action",
        actionIds:["fazer_vinheta","fazer_logo","buscar_ref","pegar_tarefa"],
      },
      {
        id:"zona6", label:"Tentáculo", emoji:"🐙",
        x:75, y:0, w:22, h:32,
        type:"fala",
        falas:[
          { text:"Humm, polvos sempre representam muito bem os criativos", minDay:1 },
          { text:"Um ser misterioso está tentando perturbar a paz", minDay:3 },
        ],
      },
      {
        id:"zona7", label:"Garrafa d'água", emoji:"💧",
        x:87, y:68, w:10, h:30,
        type:"drink",
      },
    ],
    actions:[
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
    bgImage:"https://res.cloudinary.com/dio7kf0tb/image/upload/v1779908844/editoria_base_ecoegk.jpg",
    canDrink:true,
    npcs:[],
    hotspots:[],
    clickZones:[
      {
        id:"zona1", label:"Jess", emoji:"😄",
        x:5, y:28, w:16, h:60,
        type:"action+fala",
        actionIds:["meme_jess"],
        falas:[
          { text:"Você viu aquele vídeo do miau miau miau miau?", minDay:1 },
          { text:"Quer fazer uma tour pelo meu feed?", minDay:1 },
          { text:"Se achar o Xaropinho por aí me avisa!", minDay:3 },
        ],
      },
      {
        id:"zona2", label:"Monitores", emoji:"💡",
        x:21, y:35, w:18, h:50,
        type:"action",
        actionIds:["fazer_leds","fazer_ilustracao"],
      },
      {
        id:"zona3", label:"Flipchart", emoji:"📋",
        x:39, y:28, w:10, h:52,
        type:"action",
        actionIds:["trocar_ideia","fazer_laboral"],
      },
      {
        id:"zona4", label:"Kell", emoji:"✨",
        x:57, y:32, w:18, h:52,
        type:"action+fala",
        actionIds:["papo_kell"],
        falas:[
          { text:"Gente, que time incrível. Amo trabalhar aqui.", minDay:1 },
          { text:"Você tá arrasando hoje! Olha só essa arte.", minDay:1 },
          { text:"Conte com a gente friend, estamos todos nas trincheiras.", minDay:1 },
          { text:"E aí friend, como vai meu amigo, minha amiga?", minDay:1 },
        ],
      },
      {
        id:"zona5", label:"Cafeteira", emoji:"☕",
        x:75, y:38, w:10, h:28,
        type:"action",
        actionIds:["cafe_edit"],
      },
      {
        id:"zona6", label:"Garrafa d'água", emoji:"💧",
        x:86, y:2, w:12, h:26,
        type:"drink",
      },
      {
        id:"zona7", label:"Urso de pelúcia", emoji:"🐻",
        x:82, y:55, w:16, h:43,
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
      {id:"trocar_ideia",     label:"Trocar ideia com amiguinho",   emoji:"💬", time:2,  effects:{criar:-10,mexer:0,  socializar:+20}, msg:"Começou sobre trabalho, virou papo sobre série. Clássico."},
      {id:"fazer_laboral",    label:"Fazer laboral improvisado",    emoji:"🧘", time:1,  effects:{criar:-10,mexer:+70,socializar:+30}, msg:"Laboral improvisado. Estalos, alongamentos e aquela sensação de estar vivo."},
      {id:"papo_kell",        label:"Papo com a Kell ✨",            emoji:"✨", time:2,  effects:{criar:+10,mexer:-10,socializar:+40}, msg:"Kell te elogiou e te fez sentir a pessoa mais talentosa do SBT."},
      {id:"cafe_edit",        label:"Tomar um café",                emoji:"☕", time:1,  effects:{criar:+5, mexer:0,  socializar:+5},  msg:"O café da Editoria. Sem explicação, só gratidão."},
      {id:"meme_jess",        label:"Mandar meme pra Jess",         emoji:"😂", time:2,  effects:{criar:+1, mexer:-1, socializar:+20}, msg:"Jess deu uma risada alta demais. Todo mundo olhou. Valeu cada segundo."},
    ]
  },
  corredor:{
    id:"corredor", name:"Corredor", emoji:"🚶",
    bg:"linear-gradient(160deg,#111,#1c1c1c)",
    npcs:[],
    hotspots:[
      {id:"escada",   label:"Escada",    emoji:"🪜", x:22, y:48, desc:"Dois lances. Já conta como academia."},
      {id:"beb",      label:"Bebedouro", emoji:"🚿", x:78, y:55, desc:"Água gelada. De graça!"},
      {id:"janela_c", label:"Janela",    emoji:"🪟", x:52, y:35, desc:"Vista do mundão. Contemplar é pesquisa."},
    ],
    actions:[
      {id:"subir_escada", label:"Subir/descer escada",        emoji:"🪜", time:1, effects:{criar:-20,mexer:+40,socializar:0},           msg:"Ufa! Dois lances. Pode colocar no currículo: 'pratica atividade física'."},
      {id:"encher_garr",  label:"Encher a garrafinha d'água", emoji:"🚿", time:1, special:"encher", effects:{criar:-20,mexer:+30,socializar:+30}, msg:"Garrafinha cheia. Você é responsável e consciente. Por hoje."},
      {id:"janela_cor",   label:"Olhar pela janela",          emoji:"🪟", time:2, effects:{criar:+2, mexer:+20,socializar:0},           msg:"Cinco minutos fitando o horizonte. Isso é pesquisa de referência visual."},
    ]
  },
  banheiro:{
    id:"banheiro", name:"Banheiro", emoji:"🚻",
    bg:"linear-gradient(160deg,#0e1a0e,#162616)",
    npcs:[],
    hotspots:[
      {id:"pia",     label:"Pia",     emoji:"🚿", x:28, y:52, desc:"Lavar o rosto ajuda na criatividade. Fonte: alguém inventou isso."},
      {id:"espelho", label:"Espelho", emoji:"🪞", x:62, y:40, desc:"'Estou bem. Estou ótimo.' — você, todo dia."},
    ],
    actions:[
      {id:"lavar_rosto",       label:"Lavar o rosto",      emoji:"💦", time:1,       effects:{criar:-5, mexer:+5, socializar:-5},  msg:"Água fria no rosto. Reset mental ativado. Nova pessoa (por 10 minutos)."},
      {id:"pausa_estrategica", label:"Pausa estratégica",  emoji:"🚻", time:2,       effects:{criar:-30,mexer:+20,socializar:0},  msg:"A pausa mais honesta do dia. Aqui ninguém te interrompe. Sagrado."},
      {id:"cochilo",           label:"Arriscar cochilo 😴",emoji:"💤", time:0, special:"cochilo", effects:{},                    msg:"Você fechou os olhos 'só um segundo'..."},
    ]
  },
  calango:{
    id:"calango", name:"Calango 🦎", emoji:"🦎",
    bg:"linear-gradient(160deg,#0a1a00,#152800,#071000)",
    npcs:["calango"],
    hotspots:[
      {id:"bandeja", label:"Bandeja",         emoji:"🍛", x:35, y:55, desc:"A bandeja do Calango. Abundante. Econômico. Corajoso."},
      {id:"aviso",   label:"Aviso na parede", emoji:"⚠️", x:72, y:35, desc:"'Não nos responsabilizamos por desconfortos pós-refeição.'"},
    ],
    actions:[
      {id:"comer_calango", label:"Arriscar o Calango 🎲", emoji:"🦎", time:4, special:"calango_risk", effects:{}, availFrom:"11:30", msg:"Você encheu a bandeja com coragem..."},
      {id:"voltar_praca",  label:"← Voltar pra Praça",    emoji:"↩️", time:0, effects:{}, navigate:"praca", msg:"Você reconsiderou. Sábio."},
    ]
  },
  externo:{
    id:"externo", name:"Área Externa", emoji:"🌳",
    bg:"linear-gradient(160deg,#061a06,#0d2b0d,#040f04)",
    npcs:[],
    hotspots:[
      {id:"calcadao", label:"Calçadão do SBT", emoji:"🛤️", x:40, y:50, desc:"Ar fresco, árvores, e a sensação de que o mundo existe."},
      {id:"sol",      label:"Sol gostoso",      emoji:"☀️", x:72, y:30, desc:"Vitamina D gratuita. Aproveita."},
    ],
    actions:[
      {id:"voltinha",         label:"Dar a voltinha",         emoji:"🛤️", time:2, effects:{criar:-10,mexer:+30,socializar:+10}, msg:"Sol, vento, silêncio. Você lembrou que existe um mundo fora do After Effects."},
      {id:"sentar_mureta",    label:"Sentar na mureta",       emoji:"🧘", time:2, effects:{criar:-20,mexer:+10,socializar:+30}, msg:"Sentado na mureta, vendo a vida passar. Socializou com três pessoas aleatórias."},
      {id:"fumar",            label:"Fumar um cigarrinho",    emoji:"🚬", time:2, special:"fumar", effects:{criar:+10,mexer:+30,socializar:+30}, msg:"Cigarrinho aceso. A hidratação agradece não. Valeu o bafo?"},
      {id:"voltinha_calango", label:"Voltinha pós-Calango 🦎",emoji:"🚶", time:2, special:"voltinha_pos", effects:{criar:0,mexer:+30,socializar:+10}, msg:"A famosa voltinha! Ar fresco fez milagre. Você se sentiu vivo de novo. 🦎✅"},
    ]
  },
  jornalismo:{
    id:"jornalismo", name:"Jornalismo", emoji:"📡",
    bg:"linear-gradient(160deg,#1a0a1a,#2a102a,#0f050f)",
    npcs:[],
    hotspots:[
      {id:"redacao",  label:"Redação",        emoji:"🖥️", x:35, y:50, desc:"Monitores piscando, prazo apertado, adrenalina constante."},
      {id:"tv",       label:"TV ao vivo",     emoji:"📺", x:70, y:38, desc:"A câmera nunca dorme. Você também não."},
    ],
    actions:[
      {id:"pacote_grafico", label:"Pacote Gráfico Especial",  emoji:"🎞️", time:16, effects:{criar:+50,mexer:-50,socializar:+10}, msg:"4 horas produzindo o pacote. Grandioso. Vale o sofrimento."},
      {id:"censurar_crime", label:"Censurar imagens de crime",emoji:"🫣",  time:2,  effects:{criar:+30,mexer:-30,socializar:0},  msg:"30 minutos desfocando coisas que você não queria ter visto."},
      {id:"checar_email",   label:"Checar o e-mail",          emoji:"📧",  time:1,  effects:{criar:+20,mexer:-10,socializar:+20}, msg:"15 minutos de e-mails. Metade spam. A outra metade também."},
      {id:"cafe_gui",       label:"Tomar café com o Gui",     emoji:"☕",  time:0,  effects:{criar:+10,mexer:-1, socializar:+40}, msg:"O Gui tem histórias incríveis. E um café ainda melhor."},
      {id:"agua_coco",      label:"Água de Coco Mágica 🥥",   emoji:"🥥",  time:0,  effects:{agua:+100},                         msg:"Uma água de coco apareceu do nada. Hidratação restaurada magicamente."},
    ]
  }
};
 
// ── COMPONENTES ───────────────────────────────────────────────────────────────
const StatBar = ({ label, emoji, value, color, locked }) => {
  const pct = clamp(value);
  const isDanger=pct<=DANGER, isWarn=pct<=WARN;
  return (
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:11,color:isDanger?"#ff4444":isWarn?"#f59e0b":"#ccc",fontFamily:"monospace",display:"flex",alignItems:"center",gap:4}}>
          {isDanger?"⚠️":emoji} {label}{locked?<span style={{fontSize:9,color:"#ff4444"}}> 🔒</span>:null}
        </span>
        <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>{Math.round(pct)}%</span>
      </div>
      <div style={{height:7,background:"#1a1a24",borderRadius:4,overflow:"hidden",border:`1px solid ${isDanger?"#ff444444":"#2a2a38"}`}}>
        <div style={{height:"100%",width:`${pct}%`,background:isDanger?"#ff4444":isWarn?"#f59e0b":color,borderRadius:4,transition:"width 0.5s ease,background 0.3s"}}/>
      </div>
    </div>
  );
};
 
// Duas barras: garrafa + hidratação
const HydSection = ({ garrafa, agua, canDrinkHere }) => {
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
      <div style={{marginBottom:4}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
          <span style={{fontSize:11,color:aIsDanger?"#ff4444":aIsWarn?"#f59e0b":"#38bdf8",fontFamily:"monospace"}}>
            {aIsDanger?"🚨":aIsWarn?"⚠️":"💧"} Hidratação
            {aIsWarn&&!canDrinkHere&&<span style={{fontSize:9,color:"#ff6644",marginLeft:4}}>(vá beber água!)</span>}
          </span>
          <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>{Math.round(pctA)}%</span>
        </div>
        <div style={{height:7,background:"#1a1a24",borderRadius:4,overflow:"hidden",border:`1px solid ${aIsDanger?"#ff444444":"#2a2a38"}`}}>
          <div style={{height:"100%",width:`${pctA}%`,background:aIsDanger?"#ff4444":aIsWarn?"#f59e0b":"#38bdf8",borderRadius:4,transition:"width 0.5s ease"}}/>
        </div>
      </div>
      <div style={{fontSize:9,color:canDrinkHere?"#0ea5e9":"#664422",marginTop:2}}>
        {canDrinkHere
          ? gEmpty?"🚫 Encha a garrafa no corredor primeiro!":"💧 Clique na garrafa para beber (−25% garrafa)"
          :"🚫 Água só na ID Visual ou Editoria"}
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
          background:l.type==="critical"?"#ffd6d6":l.type==="warn"?"#fff3cd":l.type==="water"?"#cce8ff":"#b8d8f8",
          border:l.type==="critical"?"1px solid #ffaaaa":l.type==="warn"?"1px solid #ffc107":"1px solid #7cb9e8",
          borderRadius:"14px 14px 4px 14px",padding:"7px 11px",fontSize:10.5,
          color:l.type==="critical"?"#8b1a1a":l.type==="warn"?"#7a5500":"#1a3a5c",
          lineHeight:1.5,fontFamily:"'Segoe UI',sans-serif",boxShadow:"0 1px 3px rgba(0,0,0,.1)"
        }}>{l.msg}</div>
      ))}
    </div>
  );
};
 
// Botão de ação reutilizável com contador de uso
const ActionBtn = ({ a, locked, unavail, exhausted, usageCount, limit, onAction }) => {
  const disabled = locked||unavail||exhausted;
  const remaining = limit !== undefined ? limit - (usageCount||0) : null;
  let tl = "instantâneo";
  if(a.special==="cochilo") tl="30min ~ 2h";
  else if(a.time>0) tl=`${a.time*15}min`;
 
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
          {unavail&&<span style={{fontSize:8,color:"#7a5500",marginLeft:4}}>🕐{a.availFrom}{a.availUntil?`–${a.availUntil}`:""}</span>}
          {exhausted&&<span style={{fontSize:8,color:"#3a5a3a",marginLeft:4}}>✓ esgotado</span>}
        </span>
        <span style={{fontSize:9,color:"#444",display:"block",display:"flex",gap:6}}>
          <span>{tl}</span>
          {remaining!==null&&<span style={{color:remaining<=1?"#f59e0b":remaining===0?"#555":"#556"}}>{remaining} restante{remaining!==1?"s":""}</span>}
        </span>
      </span>
    </button>
  );
};
 
// Menu popup para Identidade Visual
const ActionMenu = ({ zone, actions, locks, shiftCfg, turn, usageCounts, getLimit, onAction, onClose }) => {
  return (
    <div onClick={e=>e.stopPropagation()} style={{
      position:"absolute",
      left:`${Math.min(zone.x+zone.w+1, 58)}%`,
      top:`${Math.max(5, zone.y-5)}%`,
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
        const unavail = a.availFrom && shiftCfg && turn < timeToTurn(a.availFrom, shiftCfg.startH, shiftCfg.startM);
        const limit = getLimit(a.id);
        const usageCount = usageCounts[a.id]||0;
        const exhausted = limit!==undefined && usageCount>=limit;
        return (
          <div key={a.id} style={{marginBottom:5}}>
            <ActionBtn a={a} locked={locked} unavail={unavail} exhausted={exhausted} usageCount={usageCount} limit={limit} onAction={onAction}/>
          </div>
        );
      })}
      <button onClick={onClose} style={{width:"100%",background:"none",border:"1px solid #2a2a3a",borderRadius:6,color:"#555",fontSize:10,fontFamily:"monospace",padding:"5px",cursor:"pointer",marginTop:4}}>✕ fechar</button>
    </div>
  );
};
 
// ── INTRO ─────────────────────────────────────────────────────────────────────
const Intro = ({ onStart }) => {
  const [nome, setNome] = useState("");
  const [shift, setShift] = useState(null);
  return (
    <div style={{width:"100%",height:"100%",background:"linear-gradient(135deg,#060610,#0d0d20,#060610)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"monospace",padding:20,boxSizing:"border-box"}}>
      <div style={{maxWidth:520,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:6}}>📺</div>
        <div style={{fontSize:10,letterSpacing:5,color:"#e8c840",marginBottom:4,textTransform:"uppercase"}}>SBT — Sistema Brasileiro de Televisão</div>
        <h1 style={{fontSize:22,color:"#fff",margin:"8px 0 6px",lineHeight:1.3}}>Criação Visual:<br/><span style={{color:"#e8c840"}}>Sobreviva ao Expediente</span></h1>
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
 
        <button onClick={()=>nome.trim()&&shift&&onStart(nome.trim(),shift)}
          disabled={!nome.trim()||!shift}
          style={{background:(nome.trim()&&shift)?"#e8c840":"#222",color:(nome.trim()&&shift)?"#000":"#555",border:"none",padding:"11px 34px",borderRadius:8,cursor:(nome.trim()&&shift)?"pointer":"not-allowed",fontSize:13,fontFamily:"monospace",fontWeight:"bold",letterSpacing:2,textTransform:"uppercase",transition:"all 0.2s"}}>
          Bater o Ponto →
        </button>
      </div>
    </div>
  );
};
 
// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function SBTGame() {
  const [phase, setPhase]             = useState("intro");
  const [name, setName]               = useState("");
  const [shiftCfg, setShiftCfg]       = useState(null);
  const [turnLabels, setTurnLabels]   = useState([]);
  const [turn, setTurn]               = useState(0);
  const [scene, setScene]             = useState("praca");
  const [stats, setStats]             = useState({criar:40,socializar:40,mexer:40});
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
  const [openZone, setOpenZone]       = useState(null);
  const [zonaMsg, setZonaMsg]         = useState(null); // {text, zona} — fala ou info exibida
  const [usageCounts, setUsageCounts] = useState({}); // {actionId: count}
  const [waterClicks, setWaterClicks] = useState(0);  // a cada 2 cliques, consome 1 turno
  const [usedCriticals, setUsedCriticals] = useState({}); // {eventId: true} — eventos únicos por dia
  const [musicOn, setMusicOn]         = useState(true);
  const [volume, setVolume]           = useState(0.35);
  const [days, setDays]               = useState(0);
  const [totalTurnsWon, setTotalTurnsWon] = useState(0);
  const [ranking, setRanking]         = useState([]);
  const [showRanking, setShowRanking] = useState(false);
  const [famosoAtual, setFamosoAtual] = useState(null);   // famoso disponível hoje na praça
  const [famosoUsado, setFamosoUsado] = useState(false);  // já tirou foto hoje
  const audioRef                      = useRef(null);
 
  // Stats iniciais variam por dia
  const getInitialStats = (d) => {
    // d = expedientes já completos (0 = primeiro dia ainda)
    const day = d + 1; // dia atual (1-based)
    if(day === 1) return { criar:40, socializar:40, mexer:40 };
    if(day === 2) return { criar:30, socializar:30, mexer:30 };
    const base = Math.max(2, 28 - (day - 3) * 2); // dia 3=28, dia 4=26, dia 5=24...
    return { criar:base, socializar:base, mexer:base };
  };
 
  const addLog = (msg, type="normal") => setLog(p=>[{msg,type},...p].slice(0,50));
 
  // Sorteia famoso ao iniciar o jogo/dia (só a partir do dia 2)
  useEffect(()=>{
    if(phase!=="game") return;
    const currentDay = days + 1;
    if(currentDay >= 2 && Math.random() < 0.20){
      setFamosoAtual(sortearFamoso());
    } else {
      setFamosoAtual(null);
    }
    setFamosoUsado(false);
  },[phase, days]);
 
  // ── RANKING ────────────────────────────────────────────────────────────────
  // Carrega ranking do storage compartilhado ao montar
  useEffect(()=>{
    (async()=>{
      try {
        const res = await window.storage.get("sbt-ranking", true);
        if(res) setRanking(JSON.parse(res.value));
      } catch(e) { setRanking([]); }
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
    try {
      const res = await window.storage.get("sbt-ranking", true);
      const current = res ? JSON.parse(res.value) : [];
      const updated = [...current, entry]
        .sort((a,b) => b.totalMin - a.totalMin)
        .slice(0, 20); // top 20
      await window.storage.set("sbt-ranking", JSON.stringify(updated), true);
      setRanking(updated);
    } catch(e) {}
  };
 
  // Música de fundo
  useEffect(()=>{
    const audio = audioRef.current;
    if(!audio) return;
    audio.volume = volume;
    if(musicOn && phase==="game"){ audio.play().catch(()=>{}); }
    else { audio.pause(); }
  },[musicOn, phase, volume]);
 
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
    // Foto com famoso: indisponível no dia 1, ou se famoso não apareceu, ou já usado
    if(id==="foto_famoso"){
      const currentDay = days + 1;
      if(currentDay < 2) return true;
      if(!famosoAtual || famosoUsado) return true;
      return false;
    }
    const limit = getLimit(id);
    if(limit===undefined) return false;
    if(id==="voltinha_calango" && !calangoPassed) return true;
    return (usageCounts[id]||0) >= limit;
  };
 
  const applyFx = (fx) => {
    if(!fx) return;
    setStats(prev=>{ const n={...prev}; for(const [k,v] of Object.entries(fx)){ if(k==="agua"||k==="garrafa") continue; if(k in n) n[k]=clamp(n[k]+v); } return n; });
    if(fx.agua!=null)    setAgua(p=>clamp(p+fx.agua));
    if(fx.garrafa!=null) setGarrafa(p=>clamp(p+fx.garrafa));
  };
 
  // Beber água: consome 25% da garrafa, +20% de hidratação; a cada 2 cliques gasta 1 turno (15min)
  const drinkWater = () => {
    if(garrafa<=0){ addLog("🪣 A garrafa está vazia! Encha no corredor.","warn"); return; }
    setGarrafa(p=>clamp(p-25));
    setAgua(p=>clamp(p+20));
    addLog(`💧 ${name} tomou um gole de água. Garrafa −25%.`, "water");
  };
 
  // Hidratação: −10% em ações de mov. e soc. independente da duração
  const drainHydIfNeeded = (id) => {
    const cat = ACTION_CAT[id];
    if(cat==="mexer"||cat==="socializar") setAgua(p=>clamp(p-10));
  };
 
  const advanceTurns = (amount) => {
    if(amount<=0) return;
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
 
  const maybeCritical = (sceneId) => {
    const evts = CRITICAL_EVENTS[sceneId];
    if(!evts) return;
    // eventos raros têm 5% de chance, normais 20%
    // eventos com oncePer="day" só disparam se ainda não ocorreram hoje
    const pool = evts.filter(ev => {
      if(ev.oncePer==="day" && usedCriticals[ev.id]) return false;
      return Math.random() < (ev.raro ? 0.05 : 0.20);
    });
    if(pool.length===0) return;
    const ev = pool[Math.floor(Math.random()*pool.length)];
    if(ev.oncePer==="day") setUsedCriticals(prev=>({...prev,[ev.id]:true}));
    if(ev.type==="lock")       setLocks(prev=>({...prev,[ev.category]:Math.max(prev[ev.category]||0,ev.turns)}));
    if(ev.type==="lock_multi") ev.categories.forEach(cat=>setLocks(prev=>({...prev,[cat]:Math.max(prev[cat]||0,ev.turns)})));
    else if(ev.type==="set_stat"){ if(ev.stat==="agua") setAgua(ev.value); else setStats(prev=>({...prev,[ev.stat]:ev.value})); }
    setCritModal(ev);
    addLog(`🚨 EVENTO CRÍTICO: ${ev.title}`,"critical");
  };
 
  const isActionLocked = (id) => { const cat=ACTION_CAT[id]; return cat&&(locks[cat]||0)>0; };
 
  const isAvail = (a) => {
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
        addLog(`[${lbl}] 🦎✅ Passou no teste do Calango! +50% socialização. Voltinha liberada!`);
        setScene("externo");
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
 
    const tl = a.time===0?"instantâneo":`${a.time*15}min`;
    addLog(`[${lbl}] ${a.emoji} ${a.msg} (${tl})`);
 
    if(a.time>0){ advanceTurns(a.time); maybeCritical(scene); }
    setOpenZone(null); setHotspot(null);
  };
 
  // game over / vitória
  useEffect(()=>{
    if(phase!=="game") return;
    const all={...stats,agua};
    const labels={criar:"Criatividade zerou",socializar:"Socialização zerou",mexer:"Movimentação zerou",agua:"Desidratação"};
    const dead=Object.entries(all).find(([,v])=>v<=0);
    if(dead){
      setEndReason(labels[dead[0]]);
      saveToRanking(days, turn, false);
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
    setStats({criar:40,socializar:40,mexer:40});setAgua(70);setGarrafa(100);
    setLog([]);setHotspot(null);setNpcMsg(null);setEndReason(null);
    setCalangoPassed(false);setWarned({});setName("");setShiftCfg(null);
    setLocks({});setCritModal(null);setOpenZone(null);setUsageCounts({});
    setWaterClicks(0);setDays(0);setTotalTurnsWon(0);setShowRanking(false);setUsedCriticals({});setFamosoAtual(null);setFamosoUsado(false);setZonaMsg(null);
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
    setZonaMsg(null);
    setPhase("game");
  };
 
  const handleStart=(n,s)=>{ setName(n);setShiftCfg(s);setTurnLabels(genLabels(s.startH,s.startM));setPhase("game"); };
 
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
    <div style={OUTER}><div style={INNER}><div style={W}><Intro onStart={handleStart}/></div></div></div>
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
    const myRankPos = ranking.findIndex(r=>r.name===name&&r.totalMin===score.totalMin);
 
    const formatTime = (d,h,m) => {
      const parts=[];
      if(d>0) parts.push(`${d} dia${d!==1?"s":""}`);
      if(h>0) parts.push(`${h}h`);
      if(m>0) parts.push(`${m}min`);
      return parts.length>0?parts.join(" e "):"menos de 1min";
    };
 
    return (
      <div style={OUTER}><div style={INNER}><div style={{...W,background:survived?"linear-gradient(135deg,#001500,#002000)":"linear-gradient(135deg,#150000,#200000)",display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{width:"100%",maxWidth:900,padding:"0 24px",display:"flex",gap:20,alignItems:"flex-start",justifyContent:"center"}}>
 
          {/* Coluna esquerda: resultado */}
          <div style={{flex:"0 0 380px",textAlign:"center"}}>
            <div style={{fontSize:56,marginBottom:8}}>{survived?"🏆":"😵"}</div>
            <div style={{fontSize:9,color:"#e8c840",letterSpacing:4,textTransform:"uppercase",marginBottom:4,fontFamily:"monospace"}}>{survived?"Expediente concluído!":"Fim de expediente"}</div>
            <h2 style={{color:survived?"#66ff66":"#ff6666",fontSize:20,marginBottom:8,fontFamily:"monospace",lineHeight:1.3}}>
              {survived?`${name} se aposentou no SBT!`:`${name} não resistiu`}
            </h2>
            {!survived&&<p style={{color:"#666",fontSize:11,marginBottom:10,fontFamily:"sans-serif"}}>{endReason}</p>}
 
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
              <button onClick={()=>setShowRanking(p=>!p)} style={{background:"#1a1a2e",color:"#e8c840",border:"1px solid #e8c840",padding:"10px 20px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"monospace"}}>
                🏅 {showRanking?"Ocultar":"Ver"} Ranking
              </button>
            </div>
          </div>
 
          {/* Coluna direita: ranking */}
          {showRanking&&(
            <div style={{flex:"0 0 340px",background:"#0a0a16",border:"1px solid #1a1a2e",borderRadius:12,padding:"14px 16px",maxHeight:460,overflowY:"auto"}}>
              <div style={{fontSize:9,color:"#e8c840",letterSpacing:3,textTransform:"uppercase",marginBottom:12,fontFamily:"monospace",textAlign:"center"}}>🏅 Ranking — Top Sobreviventes</div>
              {ranking.length===0&&<div style={{color:"#333",fontSize:11,textAlign:"center",fontFamily:"monospace",padding:"20px 0"}}>Nenhum registro ainda.<br/>Seja o primeiro!</div>}
              {ranking.map((r,i)=>{
                const s=calcScore(r.days, r.extraTurns);
                const medals=["🥇","🥈","🥉"];
                const isMe = r.name===name&&r.totalMin===score.totalMin&&i===myRankPos;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:isMe?"#1a1a08":"#0d0d18",border:`1px solid ${isMe?"#e8c840":"#151525"}`,borderRadius:8,marginBottom:5}}>
                    <span style={{fontSize:14,flexShrink:0,width:22,textAlign:"center"}}>{medals[i]||`${i+1}`}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:isMe?"#e8c840":"#ccc",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {r.name} {r.calango?"🦎":""}{isMe?" ←":""}
                      </div>
                      <div style={{fontSize:9,color:"#555",marginTop:1}}>
                        {formatTime(s.d,s.h,s.m)} · {r.date}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:11,color:r.survived?"#22c55e":"#ff6666",fontFamily:"monospace",fontWeight:"bold"}}>
                        {r.days} dia{r.days!==1?"s":""}
                      </div>
                      <div style={{fontSize:8,color:"#333"}}>{r.survived?"✓ concluído":"✗ derrota"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
 
        </div>
      </div></div></div>
    );
  }
 
  const cur = SCENES[scene];
  const canDrink = !!cur.canDrink;
  const SCENE_ORDER = days >= 1 ? SCENE_ORDER_DAY2 : SCENE_ORDER_BASE;
  const allActions = (cur.actions||[]).filter(a=>a.special!=="voltinha_pos"||(calangoPassed&&!isExhausted("voltinha_calango")));
  const lbl = turnLabels[Math.min(turn,TOTAL_TURNS-1)]||"--";
  const hasLocks = Object.values(locks).some(v=>v>0);
  const isClickScene = !!cur.clickZones;
 
  return (
    <div style={OUTER}>
    <div style={INNER}>
    <div style={W}>
 
      {/* ÁUDIO DE FUNDO */}
      <audio ref={audioRef} src="https://res.cloudinary.com/dio7kf0tb/video/upload/v1777134013/Mofadinho_Salgado___Game_V4_ijxoys.mp3" loop preload="auto"/>
 
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
 
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
 
        {/* ── HEADER ── */}
        <div style={{background:"#070710",borderBottom:"2px solid #1a1a2e",padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexShrink:0,height:44}}>
 
          {/* Logo */}
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <span style={{fontSize:20}}>📺</span>
            <span style={{color:"#e8c840",fontSize:10,letterSpacing:2,textTransform:"uppercase",fontWeight:"bold"}}>SBT Criação Visual</span>
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
 
            {/* NAV */}
            <div style={{padding:"4px 8px",background:"#080814",borderBottom:"1px solid #151525",display:"flex",gap:4,flexShrink:0,overflowX:"auto"}}>
              {SCENE_ORDER.map(sid=>{
                const s=SCENES[sid];
                return (
                  <button key={sid} onClick={()=>{ setScene(sid); setHotspot(null); setNpcMsg(null); setOpenZone(null); }}
                    style={{padding:"4px 10px",background:scene===sid?"#e8c840":"#111",color:scene===sid?"#000":"#666",border:`1px solid ${scene===sid?"#e8c840":"#1e1e2e"}`,borderRadius:5,cursor:"pointer",fontSize:10,fontFamily:"monospace",whiteSpace:"nowrap",flexShrink:0}}>
                    {s.emoji} {SCENE_NAV_LABELS[sid]}
                  </button>
                );
              })}
            </div>
 
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
                  // Zona de beber água — ação direta
                  if(zone.type==="drink"){
                    drinkWater();
                    setZonaMsg({text:"💧 Você bebeu água!", zona:zone.id});
                    setOpenZone(null);
                    return;
                  }
                  // Zona de famoso — só ativa se há famoso disponível
                  if(zone.type==="famoso"){
                    if(!famosoAtual||famosoUsado) return;
                    doAction(cur.actions.find(a=>a.id==="foto_famoso"));
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
                  // Zona de ação ou action+fala ou action+dia — toggle menu
                  if(zone.type==="action+dia" && zoneDiaDisabled){ setZonaMsg({text:"⛔ Fechado a partir do 3º dia.", zona:zone.id}); return; }
                  if(isOpen){ setOpenZone(null); setZonaMsg(null); }
                  else { setOpenZone(zone); setZonaMsg(null); }
                };
 
                // Zona de famoso: só renderiza se há famoso disponível e não foi usado
                if(zone.type==="famoso" && (!famosoAtual || famosoUsado)) return null;
 
                // Zona action+dia: não renderiza a partir do maxDay
                const zoneDiaDisabled = zone.type==="action+dia" && zone.maxDay && currentDay > zone.maxDay;
 
                return (
                  <div key={zone.id}>
                    {/* Imagem do famoso sobreposta na zona */}
                    {zone.type==="famoso" && famosoAtual && !famosoUsado && (
                      <img
                        src={famosoAtual.img}
                        alt={famosoAtual.nome}
                        style={{
                          position:"absolute",
                          left:`${zone.x}%`, top:`${zone.y}%`,
                          width:`${zone.w}%`, height:`${zone.h}%`,
                          objectFit:"cover", objectPosition:"top",
                          zIndex:12, pointerEvents:"none",
                          borderRadius:4,
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
                    <div
                      onClick={handleZoneClick}
                      style={{
                        position:"absolute",
                        left:`${zone.x}%`, top:`${zone.y}%`,
                        width:`${zone.w}%`, height:`${zone.h}%`,
                        cursor:"pointer",
                        border:isOpen?"2px solid #e8c840":"2px solid transparent",
                        borderRadius:6,
                        background:isOpen?"rgba(232,200,64,.12)":"transparent",
                        transition:"all .2s", zIndex:15,
                      }}
                      onMouseEnter={e=>{if(!isOpen&&!zoneDiaDisabled){e.currentTarget.style.border="2px solid rgba(232,200,64,.4)";e.currentTarget.style.background="rgba(232,200,64,.06)";}}}
                      onMouseLeave={e=>{if(!isOpen){e.currentTarget.style.border="2px solid transparent";e.currentTarget.style.background="transparent";}}}
                    />
                    {/* Menu de ações para zonas do tipo action / action+fala */}
                    {isOpen&&(zone.type==="action"||zone.type==="action+fala"||zone.type==="action+dia")&&!zoneDiaDisabled&&(()=>{
                      const zoneActions = cur.actions.filter(a=>(zone.actionIds||[]).includes(a.id));
                      // Se action+fala: ao clicar numa ação mostra uma fala aleatória também
                      const onZoneAction = (a) => {
                        if(zone.type==="action+fala"&&zone.falas){
                          // Se a fala tem actionId, filtra só as da ação executada; senão, todas
                          const dispFalas=zone.falas.filter(f=>
                            currentDay>=f.minDay &&
                            (f.actionId===undefined || f.actionId===a.id)
                          );
                          if(dispFalas.length>0){
                            const f=dispFalas[Math.floor(Math.random()*dispFalas.length)];
                            setZonaMsg({text:`${zone.emoji} "${f.text}"`, zona:zone.id});
                          }
                        }
                        doAction(a);
                      };
                      return <ActionMenu zone={zone} actions={zoneActions} locks={locks} shiftCfg={shiftCfg} turn={turn} usageCounts={usageCounts} getLimit={getLimit} onAction={onZoneAction} onClose={()=>{setOpenZone(null);setZonaMsg(null);}}/>;
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
              <div style={{background:"#080814",flex:1,display:"flex",alignItems:"center",justifyContent:"center",borderTop:"1px solid #0f0f1e",padding:"10px 20px"}}>
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
                    <div style={{textAlign:"center",color:"#2a2a3a",fontSize:11,fontFamily:"monospace",lineHeight:1.8,userSelect:"none"}}>
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
              <StatBar label="Criatividade"  emoji="🎨" value={stats.criar}      color="#5b8dee" locked={(locks.criar||0)>0}/>
              <StatBar label="Socialização"  emoji="💬" value={stats.socializar} color="#a855f7" locked={(locks.socializar||0)>0}/>
              <StatBar label="Movimentação"  emoji="🏃" value={stats.mexer}      color="#22c55e" locked={(locks.mexer||0)>0}/>
              <HydSection garrafa={garrafa} agua={agua} canDrinkHere={canDrink}/>
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
              <span style={{fontSize:20,fontWeight:"bold",color:"#fff",fontFamily:"'Courier New',monospace",letterSpacing:3,lineHeight:1}}>{lbl}</span>
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
