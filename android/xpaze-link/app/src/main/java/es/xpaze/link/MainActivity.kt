package es.xpaze.link

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.reflect.KClass

/**
 * XPaze Link: lee de Health Connect lo que Samsung Health sincroniza desde el reloj
 * (pulso, pulso en reposo, HRV, SpO2, sueño, pasos, respiración, temperatura) y lo
 * envía a XPaze bajo un código de vinculación aleatorio. La app web solo ve los datos
 * si se le da ese código. Se reenvía cada 5 minutos mientras la app está abierta.
 */
class MainActivity : ComponentActivity() {

    private val records: List<KClass<out Record>> = listOf(
        HeartRateRecord::class, RestingHeartRateRecord::class, HeartRateVariabilityRmssdRecord::class,
        OxygenSaturationRecord::class, SleepSessionRecord::class, StepsRecord::class,
        RespiratoryRateRecord::class, BodyTemperatureRecord::class,
    )
    private val permissions = records.map { HealthPermission.getReadPermission(it) }.toSet()

    private lateinit var status: TextView
    private lateinit var summary: TextView
    private lateinit var server: EditText
    private lateinit var codeView: TextView
    private var loop: Job? = null

    private val requestPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted -> onPermissions(granted) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        val sdk = HealthConnectClient.getSdkStatus(this)
        if (sdk != HealthConnectClient.SDK_AVAILABLE) {
            say("Health Connect no está disponible en este móvil (estado $sdk). Actualiza «Health Connect» desde Play Store.")
            return
        }
        lifecycleScope.launch {
            val granted = client().permissionController.getGrantedPermissions()
            onPermissions(granted)
        }
    }

    override fun onResume() {
        super.onResume()
        startLoop()
    }

    override fun onPause() {
        super.onPause()
        loop?.cancel()
    }

    private fun client() = HealthConnectClient.getOrCreate(this)

    private fun prefs() = getSharedPreferences("xpaze", Context.MODE_PRIVATE)

    private fun code(): String {
        prefs().getString("code", null)?.let { return it }
        val alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
        val rnd = SecureRandom()
        val c = (1..8).map { alphabet[rnd.nextInt(alphabet.length)] }.joinToString("")
        prefs().edit().putString("code", c).apply()
        return c
    }

    private fun onPermissions(granted: Set<String>) {
        val missing = permissions - granted
        if (granted.isEmpty()) {
            say("Pulsa «Dar permisos» y permite leer los datos de salud.")
        } else {
            say(if (missing.isEmpty()) "Permisos concedidos." else "Permisos concedidos: ${granted.size} de ${permissions.size}.")
            startLoop()
        }
    }

    private fun startLoop() {
        if (loop?.isActive == true) return
        loop = lifecycleScope.launch {
            while (isActive) {
                syncOnce()
                delay(5 * 60_000L)
            }
        }
    }

    private suspend fun syncOnce() {
        val granted = runCatching { client().permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
        if (granted.isEmpty()) return
        say("Leyendo Health Connect…")
        val data = runCatching { readAll(granted) }.getOrElse {
            say("Error al leer: ${it.javaClass.simpleName}: ${it.message}")
            return
        }
        summary.text = describe(data)
        val url = server.text.toString().trim()
        prefs().edit().putString("server", url).apply()
        val result = withContext(Dispatchers.IO) { runCatching { post(url, data) } }
        say(result.fold({ "Enviado a XPaze a las ${ZonedDateTime.now().toLocalTime().withNano(0)} (HTTP $it). Se reenvía cada 5 min con la app abierta." },
            { "No se pudo enviar: ${it.javaClass.simpleName} ${it.message ?: ""}" }))
    }

    private suspend fun readAll(granted: Set<String>): JSONObject {
        val hc = client()
        val now = Instant.now()
        val day = TimeRangeFilter.between(now.minus(Duration.ofHours(24)), now)
        val week = TimeRangeFilter.between(now.minus(Duration.ofDays(7)), now)
        fun ok(k: KClass<out Record>) = HealthPermission.getReadPermission(k) in granted
        val out = JSONObject().put("at", now.toString()).put("source", "health-connect")

        if (ok(HeartRateRecord::class)) {
            val samples = hc.readRecords(ReadRecordsRequest(HeartRateRecord::class, day, pageSize = 1000)).records
                .flatMap { it.samples }.sortedBy { it.time }
            if (samples.isNotEmpty()) {
                val bpm = samples.map { it.beatsPerMinute }
                // una media por hora para la gráfica (como mucho 24 puntos)
                val hourly = JSONArray()
                samples.groupBy { it.time.truncatedTo(java.time.temporal.ChronoUnit.HOURS) }.toSortedMap().forEach { (h, list) ->
                    hourly.put(JSONObject().put("t", h.toString()).put("bpm", list.map { it.beatsPerMinute }.average().toInt()))
                }
                out.put("heartRate", JSONObject()
                    .put("last", bpm.last()).put("lastAt", samples.last().time.toString())
                    .put("min", bpm.min()).put("max", bpm.max()).put("avg", bpm.average().toInt())
                    .put("count", bpm.size).put("hourly", hourly))
            }
        }
        if (ok(RestingHeartRateRecord::class)) {
            hc.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, week)).records.maxByOrNull { it.time }?.let {
                out.put("restingHeartRate", JSONObject().put("bpm", it.beatsPerMinute).put("at", it.time.toString()))
            }
        }
        if (ok(HeartRateVariabilityRmssdRecord::class)) {
            hc.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, week)).records.maxByOrNull { it.time }?.let {
                out.put("hrv", JSONObject().put("rmssdMs", it.heartRateVariabilityMillis).put("at", it.time.toString()))
            }
        }
        if (ok(OxygenSaturationRecord::class)) {
            hc.readRecords(ReadRecordsRequest(OxygenSaturationRecord::class, week)).records.maxByOrNull { it.time }?.let {
                out.put("spo2", JSONObject().put("pct", it.percentage.value).put("at", it.time.toString()))
            }
        }
        if (ok(RespiratoryRateRecord::class)) {
            hc.readRecords(ReadRecordsRequest(RespiratoryRateRecord::class, week)).records.maxByOrNull { it.time }?.let {
                out.put("respiratoryRate", JSONObject().put("rpm", it.rate).put("at", it.time.toString()))
            }
        }
        if (ok(BodyTemperatureRecord::class)) {
            hc.readRecords(ReadRecordsRequest(BodyTemperatureRecord::class, week)).records.maxByOrNull { it.time }?.let {
                out.put("bodyTemperature", JSONObject().put("c", it.temperature.inCelsius).put("at", it.time.toString()))
            }
        }
        if (ok(SleepSessionRecord::class)) {
            hc.readRecords(ReadRecordsRequest(SleepSessionRecord::class, TimeRangeFilter.between(now.minus(Duration.ofHours(36)), now)))
                .records.maxByOrNull { it.endTime }?.let { s ->
                    val stages = JSONObject()
                    s.stages.groupBy { it.stage }.forEach { (st, list) ->
                        val name = when (st) {
                            SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"; SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
                            SleepSessionRecord.STAGE_TYPE_REM -> "rem"; SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
                            else -> "other"
                        }
                        stages.put(name, list.sumOf { Duration.between(it.startTime, it.endTime).toMinutes() })
                    }
                    val asleep = Duration.between(s.startTime, s.endTime).toMinutes() - stages.optLong("awake", 0)
                    out.put("sleep", JSONObject().put("start", s.startTime.toString()).put("end", s.endTime.toString())
                        .put("hours", Math.round(asleep / 6.0) / 10.0).put("stagesMin", stages))
                }
        }
        if (ok(StepsRecord::class)) {
            val midnight = ZonedDateTime.now(ZoneId.systemDefault()).toLocalDate().atStartOfDay(ZoneId.systemDefault()).toInstant()
            val agg = hc.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(midnight, now)))
            out.put("stepsToday", agg[StepsRecord.COUNT_TOTAL] ?: 0)
        }
        return out
    }

    private fun post(url: String, data: JSONObject): Int {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val body = JSONObject().put("code", code()).put("data", data).toString().toByteArray()
        conn.outputStream.use { it.write(body) }
        val status = conn.responseCode
        conn.disconnect()
        if (status !in 200..299) throw IllegalStateException("HTTP $status")
        return status
    }

    private fun describe(d: JSONObject): String {
        val lines = mutableListOf<String>()
        d.optJSONObject("heartRate")?.let { lines += "Pulso 24 h: último ${it.getInt("last")} lpm · media ${it.getInt("avg")} (${it.getInt("min")}–${it.getInt("max")})" }
        d.optJSONObject("restingHeartRate")?.let { lines += "Pulso en reposo: ${it.getLong("bpm")} lpm" }
        d.optJSONObject("hrv")?.let { lines += "HRV (RMSSD): ${"%.0f".format(it.getDouble("rmssdMs"))} ms" }
        d.optJSONObject("spo2")?.let { lines += "SpO₂: ${"%.0f".format(it.getDouble("pct"))} %" }
        d.optJSONObject("sleep")?.let { lines += "Sueño de anoche: ${it.getDouble("hours")} h" }
        d.optJSONObject("respiratoryRate")?.let { lines += "Respiración: ${"%.1f".format(it.getDouble("rpm"))} rpm" }
        d.optJSONObject("bodyTemperature")?.let { lines += "Temperatura: ${"%.1f".format(it.getDouble("c"))} °C" }
        if (d.has("stepsToday")) lines += "Pasos hoy: ${d.getLong("stepsToday")}"
        return if (lines.isEmpty()) "Health Connect no tiene datos todavía. Abre Samsung Health y activa la sincronización con Health Connect." else lines.joinToString("\n")
    }

    private fun say(msg: String) = runOnUiThread { status.text = msg }

    private fun buildUi() {
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(22), px(36), px(22), px(28))
            setBackgroundColor(Color.parseColor("#F4F3EF"))
        }
        fun text(t: String, size: Float, bold: Boolean = false, color: String = "#141414") = TextView(this).apply {
            text = t; textSize = size; setTextColor(Color.parseColor(color))
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, px(6), 0, px(6))
        }
        root.addView(text("XPaze Link", 30f, true))
        root.addView(text("Lleva a XPaze lo que Samsung Health sincroniza desde tu reloj a Health Connect.", 15f, color = "#3A3936"))
        root.addView(text("Código de vinculación", 13f, color = "#6E6C66").apply { setPadding(0, px(18), 0, 0) })
        codeView = text(code().chunked(4).joinToString(" "), 34f, true).apply { letterSpacing = 0.08f; setTextIsSelectable(true) }
        root.addView(codeView)
        root.addView(text("Escríbelo en la app XPaze (Reloj → Vincular). Quien no tenga el código no puede ver tus datos.", 13f, color = "#6E6C66"))
        root.addView(text("Servidor", 13f, color = "#6E6C66").apply { setPadding(0, px(14), 0, 0) })
        server = EditText(this).apply {
            setText(prefs().getString("server", "https://xpaze.es/app/api/salud"))
            textSize = 14f
        }
        root.addView(server)
        fun button(t: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = t; isAllCaps = false; textSize = 16f
            setTextColor(if (primary) Color.WHITE else Color.parseColor("#141414"))
            setBackgroundColor(Color.parseColor(if (primary) "#141414" else "#EBE9E3"))
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, px(52)).apply { topMargin = px(10) }
        }
        root.addView(button("Dar permisos de salud", true) { requestPermissions.launch(permissions) })
        root.addView(button("Leer y enviar ahora", false) { lifecycleScope.launch { syncOnce() } })
        root.addView(button("Nuevo código", false) {
            prefs().edit().remove("code").apply()
            codeView.text = code().chunked(4).joinToString(" ")
            lifecycleScope.launch { syncOnce() }
        })
        status = text("", 14f, color = "#1C8A2C").apply { setPadding(0, px(16), 0, 0) }
        root.addView(status)
        summary = text("", 16f).apply { setPadding(0, px(10), 0, 0) }
        root.addView(summary)
        root.addView(text("Prototipo de investigación. No es un dispositivo médico. Los datos se guardan en el servidor solo 48 h, en memoria.", 12f, color = "#6E6C66").apply { setPadding(0, px(24), 0, 0) })
        setContentView(ScrollView(this).apply { addView(root); isFillViewport = true })
    }
}
