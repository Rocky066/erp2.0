package in.garumarajv.teacher;

import android.Manifest;
import android.app.DownloadManager;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.*;
import android.os.*;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.*;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.*;

public final class MainActivity extends AppCompatActivity {
    private WebView web;
    private SwipeRefreshLayout refresh;
    private View progress;
    private View offline;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private final String portalUrl = BuildConfig.BASE_URL + "/teacher-login";
    private final ActivityResultLauncher<Intent> filePicker = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            Uri[] selected = null;
            if (result.getResultCode() == RESULT_OK) {
                Intent data = result.getData();
                if (data == null || data.getData() == null) {
                    if (cameraUri != null) selected = new Uri[]{cameraUri};
                } else if (data.getClipData() != null) {
                    selected = new Uri[data.getClipData().getItemCount()];
                    for (int i=0; i<selected.length; i++) selected[i] = data.getClipData().getItemAt(i).getUri();
                } else selected = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
            cameraUri = null;
        });

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        web = findViewById(R.id.web);
        refresh = findViewById(R.id.refresh);
        progress = findViewById(R.id.progress);
        offline = findViewById(R.id.offline);
        configureWebView();
        configureConnectivity();
        configureNotifications();
        refresh.setColorSchemeColors(getColor(R.color.gold_500));
        refresh.setOnRefreshListener(web::reload);
        String restoredUrl = web.getUrl();
        web.loadUrl(state == null || restoredUrl == null ? portalUrl : restoredUrl);
    }

    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " GarumaraTeacherAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setBackgroundColor(Color.rgb(7,17,31));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                Uri base = Uri.parse(BuildConfig.BASE_URL);
                if (Objects.equals(uri.getHost(), base.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                refresh.setRefreshing(false);
                injectAppExperience();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progress.setVisibility(View.GONE);
                    refresh.setRefreshing(false);
                    offline.setVisibility(View.VISIBLE);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                launchFileChooser(params);
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setMimeType(mime);
            request.addRequestHeader("User-Agent", agent);
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS,
                URLUtil.guessFileName(url, disposition, mime));
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
        });
    }

    private void launchFileChooser(WebChromeClient.FileChooserParams params) {
        Intent content = params.createIntent();
        content.addCategory(Intent.CATEGORY_OPENABLE);
        content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File output = new File(dir, new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", output);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { camera = null; }
        Intent chooser = Intent.createChooser(content, "Upload file or photo");
        if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        filePicker.launch(chooser);
    }

    private void configureConnectivity() {
        ConnectivityManager manager = (ConnectivityManager)getSystemService(CONNECTIVITY_SERVICE);
        manager.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    boolean wasOffline = offline.getVisibility() == View.VISIBLE;
                    offline.setVisibility(View.GONE);
                    if (wasOffline) web.reload();
                });
            }
            @Override public void onLost(Network network) {
                runOnUiThread(() -> {
                    offline.setVisibility(View.VISIBLE);
                    web.getSettings().setCacheMode(WebSettings.LOAD_CACHE_ELSE_NETWORK);
                });
            }
        });
    }


    private void configureNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 401);
        }
        PeriodicWorkRequest notices = new PeriodicWorkRequest.Builder(NoticeWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("school-notices", ExistingPeriodicWorkPolicy.UPDATE, notices);
    }
    private void injectAppExperience() {
        String js = "(function(){document.documentElement.classList.add('android-app');" +
          "var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}m.content='width=device-width,initial-scale=1,viewport-fit=cover';" +
          "if(!window.__gjvTokenRefresh){window.__gjvTokenRefresh=setInterval(async function(){var t=localStorage.getItem('teacherToken');if(!t)return;try{var r=await fetch('/api/teacher/refresh',{method:'POST',headers:{Authorization:'Bearer '+t}});if(r.ok){var d=await r.json();if(d.token)localStorage.setItem('teacherToken',d.token);}}catch(e){}},1200000);}var s=document.getElementById('gjv-native-style');if(!s){s=document.createElement('style');s.id='gjv-native-style';s.textContent='" +
          "body{overscroll-behavior-y:none;padding-top:env(safe-area-inset-top)!important;padding-bottom:env(safe-area-inset-bottom)!important}" +
          "button,a,input,select,textarea{min-height:44px}button{touch-action:manipulation}.card,.rounded-xl,.rounded-2xl{border-radius:18px!important}" +
          "@media(max-width:700px){main{padding:16px!important}.grid{gap:12px!important}table{font-size:12px}.overflow-x-auto{-webkit-overflow-scrolling:touch}}" +
          "';document.head.appendChild(s);}})();";
        web.evaluateJavascript(js, null);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        web.saveState(out);
        super.onSaveInstanceState(out);
    }

    @Override protected void onDestroy() {
        web.removeAllViews();
        web.destroy();
        super.onDestroy();
    }
}