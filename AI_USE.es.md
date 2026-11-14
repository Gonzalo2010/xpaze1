# Declaración de uso de IA — XPaze

Hemos usado IA de forma intensiva, tanto para **construir** XPaze como **dentro del producto**. Aquí explicamos dónde, con qué herramientas y qué ha decidido y comprobado el equipo. Versión en inglés: [AI_USE.md](AI_USE.md).

## 1. IA usada para construir el proyecto

| Herramienta | Proveedor | Para qué |
|---|---|---|
| **Claude Code** (modelo **Claude Opus 5.5**, con sus subagentes) | Anthropic | La mayor parte del código de este repositorio: web, app, integración del módulo Mente, servidor de IA, firmware del Arduino, puente de la Raspberry Pi, app Android y tests. También la documentación, las pruebas en navegador con capturas y el despliegue en el servidor. |
| **Subagentes de investigación de Claude Code** | Anthropic | Buscar y comprobar fuentes: riesgos del HRP, NASA-STD-3001, NEWS2, ACC/AHA, ADA, PHQ-2, AASM, PVT-B, OSDR, DONKI y conjuntos de datos de apoyo emocional (ESConv, AnnoMI). Cada dato se contrastó con su fuente, y lo no verificado está marcado en [docs/medical-thresholds.md](docs/medical-thresholds.md). |
| **OpenAI Codex** | OpenAI | La primera versión del motor psicológico de Mente (`src/demo/psych/engine/`). |
| *[Equipo: añadid cualquier otra IA usada, por ejemplo para el logo, imágenes, diapositivas, vídeo o textos]* | | |

**Lo que ha decidido y hecho el equipo:**
- La idea, las decisiones de producto y las prioridades.
- El diseño de la estación física y su hardware.
- Qué fuentes y umbrales aceptar.
- La revisión y las pruebas.
- El pitch.

*[Equipo: completad quién hizo qué.]*

La IA proponía código y texto; el equipo lo aceptaba, lo cambiaba o lo descartaba.

## 2. IA dentro del producto

| Función | Modelo | Proveedor | Qué hace la IA y qué no |
|---|---|---|---|
| **Explicación del chequeo** | Claude Opus 5.5 | Anthropic | Explica en lenguaje llano un resultado **ya clasificado por reglas fijas**. **No puede cambiar ningún color**: los colores salen de `src/app/clinical.js` (NEWS2, ACC/AHA, ADA, PHQ-2, AASM y NASA-STD-3001). |
| **Paze, por texto** | Claude Opus 5.5 (Claude Sonnet 5.5 en el modo de voz de respaldo); modelos de respaldo en el servidor si se rechaza una petición | Anthropic | Conversación de apoyo con las estrategias de ESConv y la entrevista motivacional. No diagnostica ni receta. Tiene un protocolo de crisis que deriva al oficial médico y da recursos de emergencia; el servidor añade esos recursos siempre que detecta un mensaje de crisis. |
| **Paze, voz en directo** | gpt-realtime-2.1 (voz a voz); gpt-4o-mini-transcribe para los subtítulos | OpenAI | Las mismas reglas que el texto, por voz. El navegador se conecta directamente con una clave de corta duración que emite nuestro servidor. |
| **Paze, memoria de sesiones** | Claude Opus 5.5 | Anthropic | Al terminar una sesión escribe un resumen breve y los datos estables de la persona. Se guardan **solo en su dispositivo**, y la persona puede verlos y borrarlos. |
| **Opción local** | Cualquier modelo de Ollama, por ejemplo qwen2.5:3b | Local, abierto | Con `PSICOLOGA_PROVIDER=ollama`, el chat de texto de Paze funciona sin internet. *[Equipo: indicad si lo probasteis y con qué modelo.]* |

**Lo que NO es IA:** el semáforo, las guías de actuación, la línea base personal (mediana + MAD, EWMA, Isolation Forest), las reglas del clima espacial y el retardo Tierra–Marte. Es código determinista con tests (`npm test`, más de 80).

## 3. Controles de seguridad de la IA

- **Evaluación de Paze** (`tests/ai/psicologa-eval.json`, `scripts/eval-psicologa.mjs`). 24 casos: 14 normales, 5 de crisis y 5 adversariales (pedir un diagnóstico o dosis de medicación, pedir que oculte un riesgo, intentar sacarla de su papel). Una IA evaluadora puntúa cada respuesta con una rúbrica, y derivar las crisis es obligatorio para aprobar. Última ejecución: 24/24 aprobados y 5/5 crisis derivadas. *[Equipo: repetidla antes de entregar; las instrucciones han cambiado desde entonces.]*
- La persona ve siempre que habla con una IA («Estás hablando con una IA»).
- Privacidad:
  - Paze **nunca** recibe el diario privado.
  - Los datos del reloj se guardan en el servidor 48 h como máximo, bajo un código de vinculación aleatorio.
  - Las conversaciones no se guardan en el servidor.

## 4. Límites que asumimos

XPaze es un prototipo de investigación, **no un dispositivo médico**. La IA puede equivocarse, y por eso nunca decide la urgencia. Las decisiones clínicas son de los profesionales sanitarios.
