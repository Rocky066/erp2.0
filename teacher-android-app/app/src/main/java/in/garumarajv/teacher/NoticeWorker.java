package in.garumarajv.teacher;

import android.app.*;
import android.content.*;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.*;
import org.json.*;
import java.io.*;
import java.net.*;

public final class NoticeWorker extends Worker {
    static final String CHANNEL = "school_notices";
    public NoticeWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection)new URL(BuildConfig.BASE_URL + "/api/notices").openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            if (connection.getResponseCode() != 200) return Result.retry();
            StringBuilder body = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                String line; while ((line = reader.readLine()) != null) body.append(line);
            }
            JSONArray notices = new JSONArray(body.toString());
            if (notices.length() == 0) return Result.success();
            JSONObject latest = notices.getJSONObject(0);
            String id = latest.optString("id", latest.optString("title"));
            SharedPreferences prefs = getApplicationContext().getSharedPreferences("notice_state", Context.MODE_PRIVATE);
            String previous = prefs.getString("last_notice", "");
            prefs.edit().putString("last_notice", id).apply();
            if (previous.isEmpty() || previous.equals(id)) return Result.success();
            notify(latest.optString("title", "New school notice"), latest.optString("message", latest.optString("description", "Open the Teacher App to view details.")));
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void notify(String title, String message) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "School notices", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(context, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info).setColor(context.getColor(R.color.gold_500))
            .setContentTitle(title).setContentText(message).setStyle(new NotificationCompat.BigTextStyle().bigText(message))
            .setAutoCancel(true).setContentIntent(pending).build();
        manager.notify(idFor(title), notification);
    }

    private int idFor(String value) { return Math.abs(value.hashCode()); }
}