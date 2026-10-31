// TGTI AI Office: окно обоев для Linux (Wayland, wlr-layer-shell, например Hyprland и Sway).
// Кладёт страницу офиса на слой «background» каждого монитора, под иконками рабочего стола,
// и запускает сервер офиса (office-server.mjs). Сервер выходит, когда закрыт stdin, поэтому
// при выходе этой программы сервер гаснет сам. Если сервер вышел с кодом 0, значит порт 7777
// уже занят другим сервером офиса: окна остаются, через 10 секунд пробуем запустить свой.
// Если сервер упал (код не 0 или сигнал), программа выходит с кодом 1, а systemd поднимает её снова.
// Код выхода 2: нет Wayland-композитора с wlr-layer-shell, перезапускать бесполезно.
//
// Сборка: cc -O2 host.c -o tgti-office-host $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1)
// Запуск: tgti-office-host /путь/к/папке/с/office-server.mjs
#include <unistd.h>
#include <gtk/gtk.h>
#include <gtk-layer-shell/gtk-layer-shell.h>
#include <webkit2/webkit2.h>

#define OFFICE_URL "http://127.0.0.1:7777/"

static GPtrArray *wins;          // окна по одному на монитор
static const char *office_dir;
static GPid server_pid;
static gint stdin_fd = -1;       // stdin сервера: пока открыт, сервер работает
static int exit_code = 0;
static guint monitors_timer = 0; // отложенная пересборка окон

static gboolean retry_load(gpointer view) {
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), OFFICE_URL);
  return G_SOURCE_REMOVE;
}

// сервер ещё не ответил: через секунду пробуем снова
static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent event G_GNUC_UNUSED, const char *uri G_GNUC_UNUSED, GError *error, gpointer data G_GNUC_UNUSED) {
  if (g_error_matches(error, WEBKIT_NETWORK_ERROR, WEBKIT_NETWORK_ERROR_CANCELLED)) return FALSE;
  // таймер держит ссылку на view, чтобы окно, закрытое за эту секунду, не оставило висячий указатель
  g_timeout_add_seconds_full(G_PRIORITY_DEFAULT, 1, retry_load, g_object_ref(view), g_object_unref);
  return TRUE;
}

static void on_win_destroy(GtkWidget *win, gpointer data G_GNUC_UNUSED) {
  g_ptr_array_remove(wins, win);
}

static void add_window(GdkMonitor *monitor) {
  GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  g_signal_connect(win, "destroy", G_CALLBACK(on_win_destroy), NULL);
  gtk_layer_init_for_window(GTK_WINDOW(win));
  gtk_layer_set_layer(GTK_WINDOW(win), GTK_LAYER_SHELL_LAYER_BACKGROUND);
  gtk_layer_set_monitor(GTK_WINDOW(win), monitor);
  for (int edge = 0; edge < GTK_LAYER_SHELL_EDGE_ENTRY_NUMBER; edge++) gtk_layer_set_anchor(GTK_WINDOW(win), edge, TRUE);
  gtk_layer_set_exclusive_zone(GTK_WINDOW(win), -1);                 // не сдвигать панели и окна
  gtk_layer_set_keyboard_mode(GTK_WINDOW(win), GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);

  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), NULL);
  if (wins->len > 0) webkit_web_view_set_is_muted(view, TRUE);   // звук только из первого окна
  gtk_container_add(GTK_CONTAINER(win), GTK_WIDGET(view));
  gtk_widget_show_all(win);
  webkit_web_view_load_uri(view, OFFICE_URL);
  g_ptr_array_add(wins, win);
}

static void rebuild_windows(void) {
  while (wins->len) gtk_widget_destroy(g_ptr_array_index(wins, 0));   // "destroy" убирает окно из wins
  GdkDisplay *display = gdk_display_get_default();
  for (int i = 0; i < gdk_display_get_n_monitors(display); i++) add_window(gdk_display_get_monitor(display, i));
}

static gboolean do_rebuild(gpointer data G_GNUC_UNUSED) {
  monitors_timer = 0;
  rebuild_windows();
  return G_SOURCE_REMOVE;
}

// мониторы подключаются и отключаются пачками: пересобираем окна один раз, когда всё стихло
static void on_monitors_changed(GdkDisplay *display G_GNUC_UNUSED, GdkMonitor *monitor G_GNUC_UNUSED, gpointer data G_GNUC_UNUSED) {
  if (monitors_timer) g_source_remove(monitors_timer);
  monitors_timer = g_timeout_add(500, do_rebuild, NULL);
}

static gboolean start_server(void);

static gboolean restart_server(gpointer data G_GNUC_UNUSED) {
  if (!start_server()) {
    exit_code = 1;
    gtk_main_quit();
  }
  return G_SOURCE_REMOVE;
}

static void on_server_exit(GPid pid, gint status, gpointer data G_GNUC_UNUSED) {
  g_spawn_close_pid(pid);
  if (stdin_fd >= 0) { close(stdin_fd); stdin_fd = -1; }
  if (g_spawn_check_wait_status(status, NULL)) {
    // код 0: порт занят, сервер офиса уже работает где-то ещё; окна оставляем и проверяем снова позже
    g_printerr("The office server is already running on port 7777, checking again in 10 seconds\n");
    g_timeout_add_seconds(10, restart_server, NULL);
  } else {
    g_printerr("The office server died (status %d)\n", status);
    exit_code = 1;
    gtk_main_quit();
  }
}

static gboolean start_server(void) {
  const char *node = g_getenv("NODE") ? g_getenv("NODE") : "node";
  char *script = g_build_filename(office_dir, "office-server.mjs", NULL);
  char *argv[] = { (char *)node, script, NULL };
  gchar **env = g_environ_setenv(g_get_environ(), "OFFICE_WITH_PARENT", "1", TRUE);
  GError *error = NULL;
  gboolean ok = g_spawn_async_with_pipes(office_dir, argv, env,
                                         G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                                         NULL, NULL, &server_pid, &stdin_fd, NULL, NULL, &error);
  if (!ok) {
    g_printerr("Could not start the office server: %s\n", error->message);
    g_error_free(error);
  } else {
    g_child_watch_add(server_pid, on_server_exit, NULL);
    // stdin_fd держим открытым: пока он открыт, сервер работает; закрываем в on_server_exit
  }
  g_strfreev(env);
  g_free(script);
  return ok;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    g_printerr("Usage: %s folder_with_office-server.mjs\n", argv[0]);
    return 1;
  }
  office_dir = argv[1];
  gdk_set_allowed_backends("wayland");
  if (!gtk_init_check(&argc, &argv) || !gtk_layer_is_supported()) {
    g_printerr("tgti-office-host needs a Wayland compositor with wlr-layer-shell (Hyprland, Sway, ...)\n");
    return 2;
  }
  wins = g_ptr_array_new();

  GdkDisplay *display = gdk_display_get_default();
  rebuild_windows();
  g_signal_connect(display, "monitor-added", G_CALLBACK(on_monitors_changed), NULL);
  g_signal_connect(display, "monitor-removed", G_CALLBACK(on_monitors_changed), NULL);
  if (!start_server()) return 1;
  gtk_main();
  return exit_code;
}
