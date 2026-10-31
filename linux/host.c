// TGTI AI Office: окно обоев для Linux (Wayland, wlr-layer-shell, например Hyprland и Sway).
// Кладёт страницу офиса на слой «background» каждого монитора, под иконками рабочего стола,
// и запускает сервер офиса (office-server.mjs). Сервер выходит, когда закрыт stdin, поэтому
// при выходе этой программы сервер гаснет сам. Если сервер упал, программа тоже выходит,
// а systemd поднимает её снова.
//
// Сборка: cc -O2 host.c -o tgti-office-host $(pkg-config --cflags --libs gtk+-3.0 gtk-layer-shell-0 webkit2gtk-4.1)
// Запуск: tgti-office-host /путь/к/папке/с/office-server.mjs
#include <gtk/gtk.h>
#include <gtk-layer-shell/gtk-layer-shell.h>
#include <webkit2/webkit2.h>

#define OFFICE_URL "http://127.0.0.1:7777/"

static GPtrArray *wins;          // окна по одному на монитор
static const char *office_dir;
static GPid server_pid;

static gboolean retry_load(gpointer view) {
  webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), OFFICE_URL);
  return G_SOURCE_REMOVE;
}

// сервер ещё не ответил: через секунду пробуем снова
static gboolean on_load_failed(WebKitWebView *view, WebKitLoadEvent event, const char *uri, GError *error, gpointer data) {
  g_timeout_add_seconds(1, retry_load, view);
  return TRUE;
}

static void add_window(GdkMonitor *monitor) {
  GtkWidget *win = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_layer_init_for_window(GTK_WINDOW(win));
  gtk_layer_set_layer(GTK_WINDOW(win), GTK_LAYER_SHELL_LAYER_BACKGROUND);
  gtk_layer_set_monitor(GTK_WINDOW(win), monitor);
  for (int edge = 0; edge < GTK_LAYER_SHELL_EDGE_ENTRY_NUMBER; edge++) gtk_layer_set_anchor(GTK_WINDOW(win), edge, TRUE);
  gtk_layer_set_exclusive_zone(GTK_WINDOW(win), -1);                 // не сдвигать панели и окна
  gtk_layer_set_keyboard_mode(GTK_WINDOW(win), GTK_LAYER_SHELL_KEYBOARD_MODE_NONE);

  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new());
  g_signal_connect(view, "load-failed", G_CALLBACK(on_load_failed), NULL);
  gtk_container_add(GTK_CONTAINER(win), GTK_WIDGET(view));
  gtk_widget_show_all(win);
  webkit_web_view_load_uri(view, OFFICE_URL);
  g_ptr_array_add(wins, win);
}

static void rebuild_windows(void) {
  for (guint i = 0; i < wins->len; i++) gtk_widget_destroy(g_ptr_array_index(wins, i));
  g_ptr_array_set_size(wins, 0);
  GdkDisplay *display = gdk_display_get_default();
  for (int i = 0; i < gdk_display_get_n_monitors(display); i++) add_window(gdk_display_get_monitor(display, i));
}

static void on_monitors_changed(GdkDisplay *display, GdkMonitor *monitor, gpointer data) {
  rebuild_windows();
}

static void on_server_exit(GPid pid, gint status, gpointer data) {
  g_spawn_close_pid(pid);
  gtk_main_quit();
}

static void start_server(void) {
  const char *node = g_getenv("NODE") ? g_getenv("NODE") : "node";
  char *script = g_build_filename(office_dir, "office-server.mjs", NULL);
  char *argv[] = { (char *)node, script, NULL };
  gchar **env = g_environ_setenv(g_get_environ(), "OFFICE_WITH_PARENT", "1", TRUE);
  GError *error = NULL;
  gint stdin_fd;
  if (!g_spawn_async_with_pipes(office_dir, argv, env,
                                G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                                NULL, NULL, &server_pid, &stdin_fd, NULL, NULL, &error)) {
    g_printerr("Не смог запустить сервер офиса: %s\n", error->message);
    g_error_free(error);
    gtk_main_quit();
  } else {
    g_child_watch_add(server_pid, on_server_exit, NULL);
    // stdin_fd не закрываем: пока программа жива, сервер работает; при выходе ОС закроет его сама
  }
  g_strfreev(env);
  g_free(script);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    g_printerr("Использование: %s папка_с_office-server.mjs\n", argv[0]);
    return 1;
  }
  office_dir = argv[1];
  gtk_init(&argc, &argv);
  wins = g_ptr_array_new();

  GdkDisplay *display = gdk_display_get_default();
  rebuild_windows();
  g_signal_connect(display, "monitor-added", G_CALLBACK(on_monitors_changed), NULL);
  g_signal_connect(display, "monitor-removed", G_CALLBACK(on_monitors_changed), NULL);
  start_server();
  gtk_main();
  return 0;
}
