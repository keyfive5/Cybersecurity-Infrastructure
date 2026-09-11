// KeywardServerAdmin.exe — "Keyward Server Central Administration".
// Reproduces the classic PrivateArk-style console: menu, traffic-light start/stop,
// and a Date/Time/Message log grid that tails the live Vault log.
using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.ServiceProcess;
using System.Windows.Forms;

namespace Keyward
{
    public class AdminForm : Form
    {
        private ListView _grid;
        private ImageList _icons;
        private Timer _tail;
        private long _pos;
        private ToolStripStatusLabel _status;
        private ToolStripButton _btnStart, _btnStop;
        private Keyward.Layout _lay;

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new AdminForm());
        }

        public AdminForm()
        {
            _lay = Keyward.Layout.FromRegistry();
            Text = "Keyward Server Central Administration";
            Width = 1000; Height = 620; StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(30, 30, 30);
            try { Icon = SystemIcons.Shield; } catch { }

            BuildMenu();
            BuildToolbar();
            BuildGrid();
            BuildStatus();

            _tail = new Timer(); _tail.Interval = 1000; _tail.Tick += delegate { TailLog(); UpdateState(); };
            _tail.Start();

            Load += delegate { PrimeLog(); UpdateState(); };
        }

        private void BuildMenu()
        {
            MenuStrip ms = new MenuStrip();
            ToolStripMenuItem control = new ToolStripMenuItem("Control");
            control.DropDownItems.Add("Start Server", null, delegate { StartServer(); });
            control.DropDownItems.Add("Stop Server", null, delegate { StopServer(); });
            control.DropDownItems.Add(new ToolStripSeparator());
            control.DropDownItems.Add("Exit", null, delegate { Close(); });

            ToolStripMenuItem view = new ToolStripMenuItem("View");
            view.DropDownItems.Add("Refresh", null, delegate { PrimeLog(); });
            view.DropDownItems.Add("Clear view", null, delegate { _grid.Items.Clear(); });

            ToolStripMenuItem admin = new ToolStripMenuItem("Administration");
            admin.DropDownItems.Add("Vault status...", null, delegate { ShowStatus(); });
            admin.DropDownItems.Add("Open safes folder", null, delegate { TryOpen(_lay.SafesDir); });
            admin.DropDownItems.Add("Open configuration", null, delegate { TryOpen(_lay.ConfDir); });
            admin.DropDownItems.Add(new ToolStripSeparator());
            admin.DropDownItems.Add("About Keyward Vault", null, delegate {
                MessageBox.Show(this, "Keyward Vault " + Product.Version + "\r\nPrivileged Access Management — Digital Vault\r\nBuilt by M. Hasan Zafar.",
                    "About", MessageBoxButtons.OK, MessageBoxIcon.Information); });

            ms.Items.Add(control); ms.Items.Add(view); ms.Items.Add(admin);
            MainMenuStrip = ms; Controls.Add(ms);
        }

        private void BuildToolbar()
        {
            ToolStrip ts = new ToolStrip();
            ts.BackColor = Color.FromArgb(45, 45, 45);
            _btnStart = new ToolStripButton("Start"); _btnStart.ForeColor = Color.White;
            _btnStart.Image = Dot(Color.LimeGreen); _btnStart.Click += delegate { StartServer(); };
            _btnStop = new ToolStripButton("Stop"); _btnStop.ForeColor = Color.White;
            _btnStop.Image = Dot(Color.Red); _btnStop.Click += delegate { StopServer(); };
            ToolStripButton refresh = new ToolStripButton("Refresh"); refresh.ForeColor = Color.White;
            refresh.Image = Dot(Color.DeepSkyBlue); refresh.Click += delegate { PrimeLog(); };
            ts.Items.Add(_btnStart); ts.Items.Add(_btnStop); ts.Items.Add(new ToolStripSeparator()); ts.Items.Add(refresh);
            Controls.Add(ts);
        }

        private void BuildGrid()
        {
            _icons = new ImageList(); _icons.ImageSize = new Size(16, 16); _icons.ColorDepth = ColorDepth.Depth32Bit;
            _icons.Images.Add("I", Dot(Color.DeepSkyBlue));
            _icons.Images.Add("W", Dot(Color.Gold));
            _icons.Images.Add("E", Dot(Color.Red));

            _grid = new ListView();
            _grid.View = View.Details; _grid.FullRowSelect = true; _grid.GridLines = false;
            _grid.Dock = DockStyle.Fill; _grid.SmallImageList = _icons;
            _grid.BackColor = Color.FromArgb(20, 20, 20); _grid.ForeColor = Color.Gainsboro;
            _grid.Font = new Font("Consolas", 9f);
            _grid.Columns.Add("Date", 90); _grid.Columns.Add("Time", 80); _grid.Columns.Add("Message", 780);
            Controls.Add(_grid); _grid.BringToFront();
        }

        private void BuildStatus()
        {
            StatusStrip ss = new StatusStrip();
            _status = new ToolStripStatusLabel("Ready");
            ss.Items.Add(_status);
            Controls.Add(ss);
        }

        private static Bitmap Dot(Color c)
        {
            Bitmap bmp = new Bitmap(16, 16);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                using (SolidBrush b = new SolidBrush(c)) g.FillEllipse(b, 3, 3, 10, 10);
                g.DrawEllipse(Pens.Black, 3, 3, 10, 10);
            }
            return bmp;
        }

        private void PrimeLog() { _grid.Items.Clear(); _pos = 0; TailLog(); }

        private void TailLog()
        {
            string path = _lay.LogFile;
            if (!File.Exists(path)) { _status.Text = "No log yet at " + path; return; }
            try
            {
                using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (fs.Length < _pos) _pos = 0; // rotated/truncated
                    fs.Seek(_pos, SeekOrigin.Begin);
                    using (StreamReader sr = new StreamReader(fs))
                    {
                        string line;
                        bool added = false;
                        while ((line = sr.ReadLine()) != null) { AddRow(line); added = true; }
                        _pos = fs.Position;
                        if (added && _grid.Items.Count > 0) _grid.EnsureVisible(_grid.Items.Count - 1);
                    }
                }
            }
            catch { }
        }

        private void AddRow(string raw)
        {
            string[] p = raw.Split('\t');
            if (p.Length < 5) return;
            string date = p[0], time = p[1], level = p[2], code = p[3], msg = p[4];
            ListViewItem it = new ListViewItem(date);
            it.ImageKey = (level == "E" || level == "W" || level == "I") ? level : "I";
            it.SubItems.Add(time);
            it.SubItems.Add(code + "  " + msg);
            if (level == "E") it.ForeColor = Color.FromArgb(255, 120, 120);
            else if (level == "W") it.ForeColor = Color.Gold;
            else it.ForeColor = Color.FromArgb(120, 210, 255);
            _grid.Items.Add(it);
        }

        private ServiceController Svc()
        {
            try { return new ServiceController(Product.ServiceName); } catch { return null; }
        }

        private void UpdateState()
        {
            ServiceController sc = Svc();
            if (sc == null) { _status.Text = "Service not installed"; return; }
            try
            {
                sc.Refresh();
                _status.Text = "Keyward Vault service: " + sc.Status;
                bool running = sc.Status == ServiceControllerStatus.Running;
                _btnStart.Enabled = !running; _btnStop.Enabled = running;
            }
            catch { _status.Text = "Service not installed"; _btnStart.Enabled = true; _btnStop.Enabled = false; }
        }

        private void StartServer()
        {
            ServiceController sc = Svc();
            if (sc == null) { MessageBox.Show(this, "The Keyward Vault service is not installed. Run Setup first."); return; }
            try
            {
                if (sc.Status != ServiceControllerStatus.Running)
                { sc.Start(); sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20)); }
            }
            catch (Exception ex) { MessageBox.Show(this, "Could not start the service (run as Administrator?):\r\n" + ex.Message); }
            UpdateState();
        }

        private void StopServer()
        {
            ServiceController sc = Svc();
            if (sc == null) return;
            try
            {
                if (sc.Status == ServiceControllerStatus.Running)
                { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20)); }
            }
            catch (Exception ex) { MessageBox.Show(this, "Could not stop the service (run as Administrator?):\r\n" + ex.Message); }
            UpdateState();
        }

        private void ShowStatus()
        {
            string cfgPath = _lay.ConfFile;
            string txt = "Install: " + _lay.InstallDir + "\r\nSafes: " + _lay.SafesDir + "\r\nKeys: " + _lay.KeysDir + "\r\n";
            if (File.Exists(_lay.LicenseFile))
            {
                Crypto.LicenseInfo li = Crypto.ValidateLicense(_lay.LicenseFile);
                txt += "License: " + (li.Valid ? ("valid, expires " + li.Expires) : ("INVALID — " + li.Reason)) + "\r\n";
            }
            MessageBox.Show(this, txt, "Vault status", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void TryOpen(string path)
        {
            try { if (Directory.Exists(path)) System.Diagnostics.Process.Start("explorer.exe", path); } catch { }
        }
    }
}
