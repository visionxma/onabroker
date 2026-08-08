#!/usr/bin/env node
/**
 * Atualizador diário da página /noticias/.
 *
 * Este arquivo NÃO roda na sua máquina: ele é copiado para dentro de cada
 * repositório publicado (`.noticias/atualizar.js`) e executado lá pelo GitHub
 * Actions, todo dia. Por isso é autossuficiente — sem dependências, sem
 * require de nada do projeto — e por isso lê a configuração de um JSON ao
 * lado, escrito pelo build.
 *
 * ---------------------------------------------------------------------------
 * O QUE ELE PUBLICA, E O QUE ELE DELIBERADAMENTE NÃO PUBLICA
 * ---------------------------------------------------------------------------
 * Publica:      manchete, veículo, data e link para o original.
 * Não publica:  o campo <description> do feed, que é o resumo/trecho da
 *               matéria.
 *
 * Essa linha não é excesso de zelo, é o que separa agregador de republicação.
 * Manchete + fonte + link é o que Google Notícias e Feedly fazem, e manda
 * tráfego PARA o veículo. Copiar o resumo é reproduzir texto de terceiro sem
 * licença — e passar o texto por IA para "reescrever" não resolve, porque
 * obra derivada continua sendo obra derivada.
 *
 * Os indicadores vêm da API pública do Banco Central. Dado factual não é
 * protegido por direito autoral, então esses podem ser exibidos inteiros.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const AQUI = __dirname;
const RAIZ = path.join(AQUI, '..');
const config = JSON.parse(fs.readFileSync(path.join(AQUI, 'config.json'), 'utf8'));

const UA =
  'Mozilla/5.0 (compatible; SiteInformativoBot/1.0; +' + config.siteUrl + ')';

/* ==========================================================================
   Rede
   ========================================================================== */

function buscar(url, redirecionamentos = 0) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: 20000 },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirecionamentos < 3
        ) {
          res.resume();
          return resolve(buscar(new URL(res.headers.location, url).href, redirecionamentos + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const partes = [];
        res.on('data', (d) => partes.push(d));
        res.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
      }
    );
    // Uma fonte fora do ar não pode derrubar a atualização inteira: devolve
    // null e o chamador segue com as outras.
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/* ==========================================================================
   Utilidades
   ========================================================================== */

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Desfaz entidades e CDATA que aparecem dentro dos campos do RSS. */
function limpar(t) {
  return t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const campo = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? limpar(m[1]) : '';
};

/* ==========================================================================
   Manchetes
   ========================================================================== */

/**
 * Termos que marcam a notícia como de mercado.
 *
 * Precisa bater no TÍTULO, não na categoria: o InfoMoney publica pauta
 * eleitoral e judiciária marcada como "Mercados", e filtrar por categoria
 * fazia a página de uma corretora abrir com notícia de aliança partidária.
 */
const RELEVANTES =
  /\b(bolsa|ibovespa|d[óo]lar|c[âa]mbio|juros?|selic|ipca|infla[çc][ãa]o|copom|banco central|fed\b|mercados?|a[çc][õo]es|dividendos?|balan[çc]os?|lucro|receita|commodities?|petr[óo]leo|min[ée]rio|ouro|bitcoin|cripto\w*|ethereum|b3\b|nasdaq|s&p|wall street|tesouro|renda fixa|fundos?|ETF|IPO|CDI|投)/i;

/**
 * Assuntos que derrubam a notícia mesmo que ela cite um termo de mercado.
 *
 * "Ex-governador é alvo da PF por desvio de R$ 308 mi" casa com "desvio" e
 * valores, mas é pauta policial. Numa página de corretora isso não informa
 * ninguém sobre o mercado e ainda associa a marca a notícia criminal.
 */
const DESCARTAR =
  /\b(elei[çc][õo]es?|eleitoral|candidat[oa]|vice|partid[oa]|PSB|PSDB|PT\b|PL\b|deputad[oa]|senador|governador|prefeit[oa]|c[âa]mara dos|senado|STF|TSE|ministro do|PF\b|pol[íi]cia federal|opera[çc][ãa]o da pf|preso|priso|homic[íi]dio|acidente|morte|morre|faleceu|futebol|novela|BBB)/i;

async function manchetes() {
  const itens = [];

  for (const fonte of config.fontes) {
    const xml = await buscar(fonte.url);
    if (!xml) continue;

    const blocos = xml.split(/<item[\s>]/i).slice(1);
    for (const b of blocos.slice(0, 30)) {
      const titulo = campo(b, 'title');
      const link = campo(b, 'link');
      if (!titulo || !link) continue;
      if (!RELEVANTES.test(titulo)) continue;
      if (DESCARTAR.test(titulo)) continue;

      const pub = campo(b, 'pubDate');
      const data = pub ? new Date(pub) : null;

      itens.push({
        titulo,
        link,
        veiculo: fonte.nome,
        selo: fonte.selo || null,
        data: data && !isNaN(data) ? data.toISOString() : null,
      });
    }
  }

  // Deduplica por título normalizado — o mesmo fato costuma sair em 3 veículos
  const vistos = new Set();
  let unicos = itens.filter((i) => {
    const k = i.titulo.toLowerCase().replace(/[^a-z0-9á-ú ]/g, '').slice(0, 60);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  unicos.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  /* Boilerplate de fechamento de pregão.
     O Investing.com publica um "<País> - Ações fecharam o pregão..." por praça,
     todo dia. São títulos distintos, então a deduplicação por texto não pega —
     mas o leitor vê seis linhas quase iguais ocupando metade da página. Fica
     no máximo uma, como amostra do dia. */
  const FECHAMENTO = /a[çc][õo]es fecharam o preg[ãa]o|fecharam? em (alta|baixa)/i;
  let jaTemFechamento = false;
  unicos = unicos.filter((i) => {
    if (!FECHAMENTO.test(i.titulo)) return true;
    if (jaTemFechamento) return false;
    jaTemFechamento = true;
    return true;
  });

  /* Teto por veículo.
     Sem isso, o feed que publica mais alto volume no dia toma a lista inteira
     e a página vira vitrine de uma fonte só — ruim para o leitor e frágil se
     aquele veículo sair do ar. */
  const porVeiculo = {};
  const TETO = Math.max(2, Math.ceil((config.maxManchetes || 12) / config.fontes.length) + 1);
  unicos = unicos.filter((i) => {
    porVeiculo[i.veiculo] = (porVeiculo[i.veiculo] || 0) + 1;
    return porVeiculo[i.veiculo] <= TETO;
  });

  /* Rotação por marca.
     Os 7 sites consomem as mesmas fontes. Sem isso, os 7 publicariam a mesma
     lista, na mesma ordem, todo dia — duplicação exata entre domínios. O
     deslocamento faz cada site abrir por um ponto diferente da lista. Não
     elimina a sobreposição (a fonte é a mesma), mas evita que as páginas
     sejam idênticas. */
  const giro = config.rotacao % Math.max(unicos.length, 1);
  const girados = unicos.slice(giro).concat(unicos.slice(0, giro));

  return girados.slice(0, config.maxManchetes || 12);
}

/* ==========================================================================
   Indicadores (API do Banco Central)
   ========================================================================== */

const SERIES = [
  { cod: 432, nome: 'Selic (meta)', sufixo: '% a.a.' },
  { cod: 13522, nome: 'IPCA (12 meses)', sufixo: '%' },
  { cod: 1, nome: 'Dólar (PTAX venda)', prefixo: 'R$ ' },
  { cod: 4389, nome: 'CDI', sufixo: '% a.a.' },
];

async function indicadores() {
  const saida = [];
  for (const s of SERIES) {
    const txt = await buscar(
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.cod}/dados/ultimos/1?formato=json`
    );
    if (!txt) continue;
    let dados;
    try {
      dados = JSON.parse(txt);
    } catch {
      continue;
    }
    if (!Array.isArray(dados) || !dados.length) continue;

    const { data, valor } = dados[0];
    const num = Number(valor);
    if (!isFinite(num)) continue;

    // Câmbio precisa de 4 casas; taxa em % fica melhor com 2
    const casas = s.cod === 1 ? 4 : 2;
    saida.push({
      nome: s.nome,
      valor: (s.prefixo || '') + num.toFixed(casas).replace('.', ',') + (s.sufixo || ''),
      data,
    });
  }
  return saida;
}

/* ==========================================================================
   Renderização
   ========================================================================== */

function dataBR(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function renderIndicadores(lista) {
  if (!lista.length) return '';
  return `<div class="cards cards--2">
${lista
  .map(
    (i) => `          <article class="card indicador">
            <p class="indicador__nome">${esc(i.nome)}</p>
            <p class="indicador__valor">${esc(i.valor)}</p>
            <p class="indicador__data">refer&ecirc;ncia ${esc(i.data)}</p>
          </article>`
  )
  .join('\n')}
        </div>`;
}

function renderManchetes(lista) {
  if (!lista.length) {
    return `<p>N&atilde;o foi poss&iacute;vel carregar as manchetes agora. A p&aacute;gina &eacute;
        atualizada diariamente; tente novamente mais tarde.</p>`;
  }
  /* O selo identifica o veículo; a manchete leva ao original.
     Deliberadamente NÃO usamos a foto da matéria: imagem de reportagem
     pertence ao veículo (muitas vêm de agência) e exibi-la aqui seria
     redistribuir obra de terceiro, não agregar. O selo da fonte é o que
     agregadores usam justamente por não ter esse problema. */
  return `<ul class="manchetes">
${lista
  .map(
    (m) => `          <li>
            ${m.selo ? `<img class="manchetes__selo" src="${esc(m.selo)}" alt="" aria-hidden="true" width="22" height="22" loading="lazy" decoding="async">` : ''}
            <a href="${esc(m.link)}" target="_blank" rel="noopener external">${esc(m.titulo)}</a>
            <span class="manchetes__fonte">${esc(m.veiculo)}${m.data ? ' &middot; ' + dataBR(m.data) : ''}</span>
          </li>`
  )
  .join('\n')}
        </ul>`;
}

/* ==========================================================================
   Execução
   ========================================================================== */

async function main() {
  const modelo = fs.readFileSync(path.join(AQUI, 'modelo.html'), 'utf8');

  const [lista, indics] = await Promise.all([manchetes(), indicadores()]);

  const agora = new Date();
  const carimbo = agora.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });

  const html = modelo
    .replace('<!--INDICADORES-->', renderIndicadores(indics))
    .replace('<!--MANCHETES-->', renderManchetes(lista))
    .replace(/<!--ATUALIZADO-->/g, esc(carimbo))
    .replace(/<!--ISO-->/g, agora.toISOString());

  const destino = path.join(RAIZ, 'noticias', 'index.html');
  fs.mkdirSync(path.dirname(destino), { recursive: true });

  const anterior = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';

  /* Compara ignorando o carimbo de hora: sem isso, todo dia geraria um commit
     mesmo quando nenhuma manchete mudou, enchendo o histórico de ruído e
     disparando rebuild do Pages à toa. */
  const semCarimbo = (s) => s.replace(/\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}/g, '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '');
  if (semCarimbo(anterior) === semCarimbo(html)) {
    console.log('sem mudanca real nas manchetes — nada a commitar');
    return;
  }

  fs.writeFileSync(destino, html);
  console.log(`noticias/index.html atualizado — ${lista.length} manchetes, ${indics.length} indicadores`);
}

main().catch((e) => {
  console.error('falha ao atualizar noticias:', e.message);
  process.exit(1);
});
