// ---------- utilidades de formato ----------
// La API entrega todo el utc ,aquí convierto a hora de Colombia.
const ZONA = "America/Bogota";
const fHora = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fDia  = new Intl.DateTimeFormat("es-CO", { timeZone: ZONA, day: "2-digit", month: "short" });

const hora     = iso => fHora.format(new Date(iso));
const dia      = iso => fDia.format(new Date(iso)).replace(".", "");
const etiqueta = iso => `${dia(iso)} ${hora(iso)}`;
const num = (x, d = 1) => x == null ? "–" :
  Number(x).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const $ = id => document.getElementById(id);

let campo = "Consumo total";   // se reemplaza con el field que reporta /api/salud
let grafica = null;
let pedido = 0;                // para ignorar respuestas viejas si el usuario cambia los controles rápido

// ---------- errores ----------
class ErrorApi extends Error {
  constructor(status, datos) {
    super(textoDetalle(datos));
    this.status = status;
  }
}

function textoDetalle(datos) {
  if (!datos) return "la API no dio más información.";
  const d = datos.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map(e => e.msg || JSON.stringify(e)).join("; ");
  return JSON.stringify(d ?? datos);
}

function mostrarError(e) {
  const caja = $("error");
  const msg = e instanceof ErrorApi
    ? `La API respondió con error ${e.status}: ${e.message}`
    : "No se pudo conectar con la API. Revisa que el servidor (uvicorn o el contenedor) siga corriendo.";
  caja.innerHTML = "<strong>No se pudo obtener el pronóstico</strong>";
  caja.appendChild(document.createTextNode(msg));
  caja.style.display = "block";
  $("resultado").classList.add("oculto");
  $("estado").textContent = "";
}

function ocultarError() {
  $("error").style.display = "none";
  $("resultado").classList.remove("oculto");
}

// ---------- pronóstico ----------
async function cargar() {
  const mio = ++pedido;
  const url = `/api/prediccion?horas=${$("horas").value}&historia=${$("historia").value}&confianza=${$("confianza").value}`;
  $("btn").disabled = true;
  $("estado").textContent = "Consultando la API…";

  try {
    const resp = await fetch(url);
    const datos = await resp.json().catch(() => null);
    if (mio !== pedido) return;
    if (!resp.ok) throw new ErrorApi(resp.status, datos);

    ocultarError();
    pintar(datos);
    $("estado").textContent = `Consultado a las ${hora(new Date().toISOString())} (hora Colombia)`;
  } catch (e) {
    if (mio !== pedido) return;
    mostrarError(e);
  } finally {
    if (mio === pedido) $("btn").disabled = false;
  }
}

function pintar(datos) {
  const hist = datos.historico || [];
  const pred = datos.prediccion || [];
  const n = hist.length;
  const ultimo = n ? hist[n - 1] : null;

  // --- indicadores ---
  const proxima = pred[0];
  const maximo = pred.length ? pred.reduce((a, b) => b.prediccion > a.prediccion ? b : a) : null;
  const rell = datos.horas_rellenadas ?? 0;
  const ctx = datos.horas_contexto_usadas ?? 0;
  const ratio = ctx ? rell / ctx : 0;
  const claseCal = rell === 0 ? "ok" : (ratio >= 0.1 ? "alerta" : "");
  const textoCal = rell === 0
    ? "sin huecos en los datos"
    : (ratio >= 0.1 ? "el sensor estuvo caído, pronóstico menos confiable" : "pocos huecos, sin mayor efecto");

  $("indicadores").innerHTML = `
    <div class="ind pron">
      <span class="ind-t">Próxima hora${proxima ? " (" + hora(proxima.tiempo) + ")" : ""}</span>
      <span class="ind-v">${proxima ? num(proxima.prediccion) : "–"}</span>
      <span class="ind-s">${proxima ? "entre " + num(proxima.limite_inferior) + " y " + num(proxima.limite_superior) : ""}</span>
    </div>
    <div class="ind pron">
      <span class="ind-t">Máximo esperado</span>
      <span class="ind-v">${maximo ? num(maximo.prediccion) : "–"}</span>
      <span class="ind-s">${maximo ? "hacia las " + hora(maximo.tiempo) + " del " + dia(maximo.tiempo) : ""}</span>
    </div>
    <div class="ind">
      <span class="ind-t">Último dato real</span>
      <span class="ind-v">${ultimo ? num(ultimo.valor) : "–"}</span>
      <span class="ind-s">${ultimo ? dia(ultimo.tiempo) + ", " + hora(ultimo.tiempo) + " (hora Colombia)" : ""}</span>
    </div>
    <div class="ind ${claseCal}">
      <span class="ind-t">Horas rellenadas</span>
      <span class="ind-v">${rell} de ${ctx}</span>
      <span class="ind-s">${textoCal}</span>
    </div>`;

  // --- tabla ---
  $("filas").innerHTML = pred.map(p => `
    <tr>
      <td>${dia(p.tiempo)} ${hora(p.tiempo)}</td>
      <td>${num(p.prediccion, 2)}</td>
      <td>${num(p.limite_inferior, 2)}</td>
      <td>${num(p.limite_superior, 2)}</td>
    </tr>`).join("");

  // --- gráfica ---
  dibujar(hist, pred, datos.confianza);
}

function dibujar(hist, pred, confianza) {
  const n = hist.length;
  const labels = [...hist.map(h => etiqueta(h.tiempo)), ...pred.map(p => etiqueta(p.tiempo))];

  // Para que la línea del pronóstico y el intervalo arranquen pegados al último dato real,
  // la última observación se repite como primer punto de esas series.
  const relleno = Math.max(n - 1, 0);
  const ancla = n ? hist[n - 1].valor : null;
  const arranque = n ? [ancla] : [];
  const vacios = k => new Array(k).fill(null);

  const sHist = [...hist.map(h => h.valor), ...vacios(pred.length)];
  const sPred = [...vacios(relleno), ...arranque, ...pred.map(p => p.prediccion)];
  const sInf  = [...vacios(relleno), ...arranque, ...pred.map(p => p.limite_inferior)];
  const sSup  = [...vacios(relleno), ...arranque, ...pred.map(p => p.limite_superior)];

  // línea vertical que separa pasado de futuro
  const marcaAhora = {
    id: "marcaAhora",
    afterDatasetsDraw(ch) {
      if (!n) return;
      const { ctx, chartArea: { top, bottom }, scales: { x } } = ch;
      const px = x.getPixelForValue(n - 1);
      ctx.save();
      ctx.strokeStyle = "#8a959d";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (grafica) grafica.destroy();
  grafica = new Chart($("lienzo"), {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Histórico", data: sHist, borderColor: "#1f5f8b", borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: "Límite inferior", data: sInf, borderColor: "transparent", pointRadius: 0, fill: false },
        { label: `Intervalo de confianza ${Math.round(confianza * 100)} %`, data: sSup,
          borderColor: "transparent", backgroundColor: "rgba(210, 96, 26, 0.18)", pointRadius: 0, fill: "-1" },
        { label: "Pronóstico", data: sPred, borderColor: "#d2601a", borderWidth: 2,
          borderDash: [6, 4], pointRadius: 2, pointBackgroundColor: "#d2601a", tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } },
        y: { title: { display: true, text: campo } }
      },
      plugins: {
        legend: { labels: { filter: item => item.datasetIndex !== 1 } },
        tooltip: {
          filter: item => item.datasetIndex !== 1 && item.datasetIndex !== 2,
          callbacks: {
            label: c => `${c.dataset.label}: ${num(c.parsed.y, 2)}`,
            afterBody: items => {
              const i = items[0].dataIndex;
              if (i >= n && sInf[i] != null) return `Intervalo: ${num(sInf[i], 2)} a ${num(sSup[i], 2)}`;
            }
          }
        }
      }
    },
    plugins: [marcaAhora]
  });
}

// ---------- datos del servicio (salud y modelo) ----------
async function cargarSalud() {
  try {
    const s = await (await fetch("/api/salud")).json();
    if (s.field) campo = s.field.replace(/_/g, " ");
    if (s.measurement && s.field) {
      $("subtitulo").textContent = `Modelo SARIMA · serie ${s.measurement} / ${s.field} · datos de InfluxDB`;
    }
    if (s.modelo_demo) $("tagDemo").style.display = "inline-block";
    $("pie").textContent = `Computación Avanzada · Proyecto final · atendido por: ${s.atendido_por ?? "desconocido"}`;
  } catch (e) {
    $("pie").textContent = "Computación Avanzada · Proyecto final";
  }
}

async function cargarModelo() {
  const dl = $("datosModelo");
  try {
    const resp = await fetch("/api/modelo");
    const m = await resp.json();
    if (!resp.ok) throw new Error();
    dl.innerHTML = "";
    for (const [k, v] of Object.entries(m)) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k.replace(/_/g, " ");
      dd.textContent = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);
      dl.append(dt, dd);
    }
  } catch (e) {
    dl.innerHTML = "<dt>Estado</dt><dd>no se pudo leer /api/modelo</dd>";
  }
}

// ---------- arranque ----------
$("controles").addEventListener("submit", e => { e.preventDefault(); cargar(); });
["horas", "historia", "confianza"].forEach(id => $(id).addEventListener("change", cargar));

cargarSalud().then(cargar);
cargarModelo();