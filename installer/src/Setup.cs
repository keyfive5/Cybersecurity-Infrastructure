// Setup.exe — the Keyward Vault installation wizard.
// A multi-page WinForms wizard that mirrors a classic Digital Vault install, then
// performs a real install via Keyward.Installer. Also supports:
//   Setup.exe --silent [key=value ...]   headless install (used for testing)
//   Setup.exe --uninstall                remove the service and program files
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace Keyward
{
    public class SetupForm : Form
    {
        private readonly InstallOptions opt = new InstallOptions();
        private int _page;
        private Func<bool> _validate;   // per-page, returns false to block Next
        private bool _installed;
        private CheckBox _restart;

        private Panel _banner, _content, _buttons;
        private Label _title, _sub;
        private Button _back, _next, _cancel;

        private static readonly string[] Titles = new string[] {
            "Welcome", "License Agreement", "User Information", "Vault Installation Mode",
            "Choose Destination Location", "Choose Safes Location", "License File",
            "Operator Keys", "Remote Control Agent", "Keyward Message Bus",
            "Vault Server Machine Hardening", "Select Program Folder",
            "Set Built-in Users' Passwords", "Ready to Install", "Setup Complete"
        };
        private const int PAGE_INSTALL = 13;
        private const int PAGE_DONE = 14;

        // ---------- entry point ----------
        [STAThread]
        public static void Main(string[] args)
        {
            List<string> a = new List<string>(args);
            if (a.Contains("--uninstall")) { RunUninstallConsole(); return; }
            if (a.Contains("--silent")) { RunSilent(a); return; }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // RDP-session warning (as the real Digital Vault shows when installed over RDP)
            if (SystemInformation.TerminalServerSession)
            {
                DialogResult r = MessageBox.Show(
                    "Setup has detected that the Vault is being installed over a Remote Desktop (RDP) session.\r\n\r\n" +
                    "Continuing will allow future RDP access to the Vault server, which lowers the Vault's security level. " +
                    "For a production install, run Setup from the machine console.\r\n\r\nDo you want to continue?",
                    "Keyward Vault Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (r != DialogResult.Yes) return;
            }
            Application.Run(new SetupForm());
        }

        public SetupForm()
        {
            Text = "Keyward Vault Setup";
            Width = 700; Height = 520; FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = true; StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            try { Icon = SystemIcons.Shield; } catch { }

            _banner = new Panel(); _banner.Dock = DockStyle.Top; _banner.Height = 64;
            _banner.BackColor = Color.FromArgb(16, 24, 40); _banner.Paint += PaintBanner;
            _title = new Label(); _title.ForeColor = Color.White; _title.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            _title.Left = 78; _title.Top = 12; _title.AutoSize = true; _title.BackColor = Color.Transparent;
            _sub = new Label(); _sub.ForeColor = Color.FromArgb(150, 200, 235); _sub.Font = new Font("Segoe UI", 8.5f);
            _sub.Left = 80; _sub.Top = 38; _sub.AutoSize = true; _sub.BackColor = Color.Transparent;
            _banner.Controls.Add(_title); _banner.Controls.Add(_sub);

            _buttons = new Panel(); _buttons.Dock = DockStyle.Bottom; _buttons.Height = 56;
            _buttons.BackColor = Color.FromArgb(240, 240, 240);
            _cancel = MkBtn("Cancel", 590); _cancel.Click += delegate { if (Confirm()) Close(); };
            _next = MkBtn("Next >", 500); _next.Click += delegate { OnNext(); };
            _back = MkBtn("< Back", 410); _back.Click += delegate { OnBack(); };
            _buttons.Controls.Add(_back); _buttons.Controls.Add(_next); _buttons.Controls.Add(_cancel);

            _content = new Panel(); _content.Dock = DockStyle.Fill; _content.Padding = new Padding(24, 18, 24, 12);
            _content.BackColor = Color.White;

            Controls.Add(_content); Controls.Add(_buttons); Controls.Add(_banner);
            ShowPage(0);
        }

        private Button MkBtn(string text, int left)
        {
            Button b = new Button(); b.Text = text; b.Width = 84; b.Height = 28; b.Left = left; b.Top = 14;
            b.FlatStyle = FlatStyle.System; return b;
        }
        private void PaintBanner(object s, PaintEventArgs e)
        {
            using (SolidBrush teal = new SolidBrush(Color.FromArgb(45, 212, 191)))
            using (SolidBrush gold = new SolidBrush(Color.FromArgb(245, 179, 1)))
            {
                e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                e.Graphics.FillRectangle(new System.Drawing.Drawing2D.LinearGradientBrush(
                    new Rectangle(20, 14, 36, 36), Color.FromArgb(45, 212, 191), Color.FromArgb(245, 179, 1), 45f), 20, 14, 36, 36);
                using (Font f = new Font("Segoe UI", 15f, FontStyle.Bold))
                    e.Graphics.DrawString("K", f, new SolidBrush(Color.FromArgb(6, 35, 31)), 27, 15);
            }
        }

        // ---------- navigation ----------
        private void ShowPage(int i)
        {
            _page = i;
            _content.Controls.Clear();
            _validate = null;
            _title.Text = Titles[i];
            _sub.Text = SubFor(i);
            _back.Enabled = (i > 0 && i < PAGE_INSTALL);
            _next.Enabled = true;
            _next.Text = (i == PAGE_INSTALL) ? "Install" : (i == PAGE_DONE ? "Finish" : "Next >");
            _cancel.Enabled = (i < PAGE_INSTALL);

            switch (i)
            {
                case 0: PageWelcome(); break;
                case 1: PageLicense(); break;
                case 2: PageUser(); break;
                case 3: PageMode(); break;
                case 4: PageDest(); break;
                case 5: PageSafes(); break;
                case 6: PageLicenseFile(); break;
                case 7: PageKeys(); break;
                case 8: PageRemoteAgent(); break;
                case 9: PageMessageBus(); break;
                case 10: PageHardening(); break;
                case 11: PageProgramFolder(); break;
                case 12: PagePasswords(); break;
                case 13: PageInstall(); break;
                case 14: PageDone(); break;
            }
        }
        private string SubFor(int i)
        {
            switch (i)
            {
                case 1: return "Please read the following license agreement carefully.";
                case 2: return "Enter your registration information.";
                case 4: return "Select where Setup will install files.";
                case 5: return "Choose the folder for storing the Safes.";
                case 12: return "Set the passwords for the built-in Master and Administrator users.";
                default: return "Keyward Vault " + Product.Version;
            }
        }
        private void OnNext()
        {
            if (_page == PAGE_DONE) { DoFinish(); return; }
            if (_page == PAGE_INSTALL) { if (_installed) ShowPage(PAGE_DONE); return; }
            if (_validate != null && !_validate()) return;
            ShowPage(_page + 1);
        }
        private void DoFinish()
        {
            if (_restart != null && _restart.Checked) { try { System.Diagnostics.Process.Start("shutdown", "/r /t 5"); } catch { } }
            Close();
        }
        private void OnBack() { if (_page > 0) ShowPage(_page - 1); }
        private bool Confirm()
        {
            return MessageBox.Show(this, "Cancel Keyward Vault Setup?", "Keyward Vault Setup",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
        }

        // ---------- small control helpers ----------
        private Label Para(string text, int top)
        {
            Label l = new Label(); l.Text = text; l.Left = 0; l.Top = top; l.Width = 620; l.AutoSize = false; l.Height = 60;
            l.Font = new Font("Segoe UI", 9.5f); return l;
        }
        private Label Cap(string text, int top)
        {
            Label l = new Label(); l.Text = text; l.Left = 0; l.Top = top; l.AutoSize = true; l.Font = new Font("Segoe UI", 9f); return l;
        }
        private TextBox Txt(string val, int top, int width)
        {
            TextBox t = new TextBox(); t.Text = val; t.Left = 0; t.Top = top; t.Width = width; t.Font = new Font("Segoe UI", 9.5f); return t;
        }
        private Button BrowseBtn(int left, int top, EventHandler h)
        {
            Button b = new Button(); b.Text = "Browse..."; b.Left = left; b.Top = top - 1; b.Width = 90; b.Height = 24; b.Click += h; return b;
        }

        // ---------- pages ----------
        private void PageWelcome()
        {
            _content.Controls.Add(Cap("Welcome to Keyward Vault " + Product.Version + " Setup", 6));
            ((Label)_content.Controls[0]).Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            ((Label)_content.Controls[0]).AutoSize = true;
            _content.Controls.Add(Para(
                "This program will install the Keyward Vault — the encrypted store at the heart of the Keyward " +
                "privileged access management platform — on this computer.\r\n\r\n" +
                "It is strongly recommended that you exit all other programs before continuing.", 46));
            Label note = Para("Keyward Vault is your own PAM Digital Vault. Built by M. Hasan Zafar.", 150);
            note.ForeColor = Color.Gray; note.Font = new Font("Segoe UI", 8.5f, FontStyle.Italic);
            _content.Controls.Add(note);
        }

        private void PageLicense()
        {
            TextBox tb = new TextBox();
            tb.Multiline = true; tb.ReadOnly = true; tb.ScrollBars = ScrollBars.Vertical;
            tb.Left = 0; tb.Top = 4; tb.Width = 624; tb.Height = 250; tb.Font = new Font("Segoe UI", 8.5f);
            tb.Text = LicenseText();
            RadioButton accept = new RadioButton(); accept.Text = "I accept the terms of the license agreement";
            accept.Left = 0; accept.Top = 264; accept.Width = 400;
            RadioButton decline = new RadioButton(); decline.Text = "I do not accept"; decline.Left = 0; decline.Top = 288; decline.Width = 300; decline.Checked = true;
            _content.Controls.Add(tb); _content.Controls.Add(accept); _content.Controls.Add(decline);
            _validate = delegate {
                if (!accept.Checked) { Warn("You must accept the license agreement to continue."); return false; }
                return true;
            };
        }

        private void PageUser()
        {
            _content.Controls.Add(Para("Please enter your name and the name of the company for whom you work.", 4));
            _content.Controls.Add(Cap("Name:", 60));
            TextBox name = Txt(opt.Name, 80, 380);
            _content.Controls.Add(Cap("Company:", 120));
            TextBox comp = Txt(opt.Company, 140, 380);
            _content.Controls.Add(name); _content.Controls.Add(comp);
            _validate = delegate {
                if (name.Text.Trim().Length == 0 || comp.Text.Trim().Length == 0) { Warn("Please enter both your name and company."); return false; }
                opt.Name = name.Text.Trim(); opt.Company = comp.Text.Trim(); return true;
            };
        }

        private void PageMode()
        {
            _content.Controls.Add(Para(
                "The Keyward Vault can be installed as a standalone server or as a node in a high-availability cluster.", 4));
            RadioButton std = new RadioButton(); std.Text = "Standalone Vault installation"; std.Left = 8; std.Top = 66; std.Width = 400;
            std.Checked = (opt.Mode != "Cluster");
            Label stdd = Cap("A single self-contained Vault. Recommended for labs and testing.", 90); stdd.Left = 28; stdd.ForeColor = Color.Gray;
            RadioButton cl = new RadioButton(); cl.Text = "Cluster-node Vault installation"; cl.Left = 8; cl.Top = 124; cl.Width = 400;
            cl.Checked = (opt.Mode == "Cluster");
            Label cld = Cap("A node in an HA cluster. Enter the peer node's address below.", 148); cld.Left = 28; cld.ForeColor = Color.Gray;
            Label pl = Cap("Peer node address:", 178); pl.Left = 28;
            TextBox peer = Txt(opt.ClusterPeer, 198, 300); peer.Left = 28; peer.Enabled = cl.Checked;
            cl.CheckedChanged += delegate { peer.Enabled = cl.Checked; };
            _content.Controls.Add(std); _content.Controls.Add(stdd); _content.Controls.Add(cl); _content.Controls.Add(cld);
            _content.Controls.Add(pl); _content.Controls.Add(peer);
            _validate = delegate {
                opt.Mode = cl.Checked ? "Cluster" : "Standalone";
                opt.ClusterPeer = peer.Text.Trim();
                if (opt.Mode == "Cluster" && opt.ClusterPeer.Length == 0) { Warn("Enter the peer node address for a cluster install."); return false; }
                return true;
            };
        }

        private void PageDest()
        {
            _content.Controls.Add(Para("Setup will install the Keyward Vault in the following folder. To install to a different folder, click Browse.", 4));
            _content.Controls.Add(Cap("Destination folder:", 70));
            TextBox dir = Txt(opt.InstallDir, 90, 500); _content.Controls.Add(dir);
            _content.Controls.Add(BrowseBtn(516, 90, delegate { string p = PickFolder(dir.Text); if (p != null) dir.Text = p; }));
            _validate = delegate { opt.InstallDir = dir.Text.Trim(); return NonEmpty(opt.InstallDir, "installation folder"); };
        }

        private void PageSafes()
        {
            _content.Controls.Add(Para("Choose the folder where the Vault will store its Safes (the encrypted credential containers).", 4));
            _content.Controls.Add(Cap("Safes folder:", 70));
            TextBox dir = Txt(opt.SafesDir, 90, 500); _content.Controls.Add(dir);
            _content.Controls.Add(BrowseBtn(516, 90, delegate { string p = PickFolder(dir.Text); if (p != null) dir.Text = p; }));
            _validate = delegate { opt.SafesDir = dir.Text.Trim(); return NonEmpty(opt.SafesDir, "safes folder"); };
        }

        private void PageLicenseFile()
        {
            _content.Controls.Add(Para(
                "A license is required to run the Vault. Keyward can generate one for you automatically — no license server needed.", 4));
            RadioButton gen = new RadioButton(); gen.Text = "Generate a Keyward license automatically (recommended)";
            gen.Left = 8; gen.Top = 62; gen.Width = 460; gen.Checked = opt.GenerateLicense;
            Label gd = Cap("Creates a signed license.xml valid for 365 days, licensed to your company.", 86); gd.Left = 28; gd.ForeColor = Color.Gray;
            RadioButton use = new RadioButton(); use.Text = "Use an existing license.xml"; use.Left = 8; use.Top = 120; use.Width = 300; use.Checked = !opt.GenerateLicense;
            TextBox path = Txt(opt.LicensePath, 146, 430); path.Left = 28; path.Enabled = use.Checked;
            Button br = BrowseBtn(466, 146, delegate {
                OpenFileDialog d = new OpenFileDialog(); d.Filter = "License (*.xml)|*.xml|All files|*.*";
                if (d.ShowDialog() == DialogResult.OK) path.Text = d.FileName;
            }); br.Left = 466; br.Enabled = use.Checked;
            Label status = Cap("", 176); status.Left = 28; status.Width = 560;
            use.CheckedChanged += delegate { path.Enabled = use.Checked; br.Enabled = use.Checked; };
            _content.Controls.Add(gen); _content.Controls.Add(gd); _content.Controls.Add(use);
            _content.Controls.Add(path); _content.Controls.Add(br); _content.Controls.Add(status);
            _validate = delegate {
                opt.GenerateLicense = gen.Checked;
                opt.LicensePath = path.Text.Trim();
                if (use.Checked)
                {
                    if (!File.Exists(opt.LicensePath)) { Warn("Select a license.xml file, or choose automatic generation."); return false; }
                    Crypto.LicenseInfo li = Crypto.ValidateLicense(opt.LicensePath);
                    if (!li.Valid) { Warn("That license is not valid: " + li.Reason + "."); return false; }
                }
                return true;
            };
        }

        private void PageKeys()
        {
            _content.Controls.Add(Para(
                "The Operator Keys contain the Server key, the Recovery public key and the initial random data. " +
                "Default (generate new) is recommended for security.", 4));
            RadioButton gen = new RadioButton(); gen.Text = "Generate new Operator Keys (recommended)"; gen.Left = 8; gen.Top = 72; gen.Width = 420; gen.Checked = opt.GenerateKeys;
            RadioButton use = new RadioButton(); use.Text = "Use existing keys from a folder"; use.Left = 8; use.Top = 108; use.Width = 320; use.Checked = !opt.GenerateKeys;
            TextBox path = Txt(opt.ExistingKeysDir, 134, 430); path.Left = 28; path.Enabled = use.Checked;
            Button br = BrowseBtn(466, 134, delegate { string p = PickFolder(path.Text); if (p != null) path.Text = p; }); br.Left = 466; br.Enabled = use.Checked;
            use.CheckedChanged += delegate { path.Enabled = use.Checked; br.Enabled = use.Checked; };
            _content.Controls.Add(gen); _content.Controls.Add(use); _content.Controls.Add(path); _content.Controls.Add(br);
            _validate = delegate {
                opt.GenerateKeys = gen.Checked; opt.ExistingKeysDir = path.Text.Trim();
                if (use.Checked && !Directory.Exists(opt.ExistingKeysDir)) { Warn("Select an existing keys folder, or generate new keys."); return false; }
                return true;
            };
        }

        private void PageRemoteAgent()
        {
            _content.Controls.Add(Para(
                "The Remote Control Agent lets you perform administrative Vault operations from a remote terminal.", 4));
            RadioButton skip = new RadioButton(); skip.Text = "Skip Remote Control Agent configuration"; skip.Left = 8; skip.Top = 62; skip.Width = 420; skip.Checked = !opt.ConfigureRemoteAgent;
            RadioButton cfg = new RadioButton(); cfg.Text = "Configure Remote Control Agent"; cfg.Left = 8; cfg.Top = 98; cfg.Width = 420; cfg.Checked = opt.ConfigureRemoteAgent;
            Label il = Cap("Remote terminal IP address:", 130); il.Left = 28;
            TextBox ip = Txt(opt.RemoteAgentIp, 150, 260); ip.Left = 28; ip.Enabled = cfg.Checked;
            cfg.CheckedChanged += delegate { ip.Enabled = cfg.Checked; };
            _content.Controls.Add(skip); _content.Controls.Add(cfg); _content.Controls.Add(il); _content.Controls.Add(ip);
            _validate = delegate {
                opt.ConfigureRemoteAgent = cfg.Checked; opt.RemoteAgentIp = ip.Text.Trim();
                if (cfg.Checked && opt.RemoteAgentIp.Length == 0) { Warn("Enter the remote terminal IP address, or choose Skip."); return false; }
                return true;
            };
        }

        private void PageMessageBus()
        {
            _content.Controls.Add(Para(
                "The Keyward Message Bus enables internal communication between components in a Distributed Vaults environment. " +
                "Select this only if you are using Distributed Vaults with PSM.", 4));
            CheckBox cb = new CheckBox(); cb.Text = "Install the Keyward Message Bus (internal communication platform)";
            cb.Left = 8; cb.Top = 80; cb.Width = 500; cb.Checked = opt.InstallMessageBus;
            _content.Controls.Add(cb);
            _validate = delegate { opt.InstallMessageBus = cb.Checked; return true; };
        }

        private void PageHardening()
        {
            _content.Controls.Add(Para(
                "Keyward recommends hardening the operating system. Hardening disables OS services that are not required to " +
                "operate the Vault Server. To remove hardening later you must reinstall the OS.", 4));
            CheckBox cb = new CheckBox(); cb.Text = "Do not harden the machine";
            cb.Left = 8; cb.Top = 92; cb.Width = 400; cb.Checked = !opt.HardenMachine;
            Label d = Cap("Not recommended. Leave unchecked for a hardened Vault; check it for a quick lab install.", 116); d.Left = 28; d.ForeColor = Color.Gray;
            _content.Controls.Add(cb); _content.Controls.Add(d);
            _validate = delegate { opt.HardenMachine = !cb.Checked; return true; };
        }

        private void PageProgramFolder()
        {
            _content.Controls.Add(Para("Setup will add program shortcuts to the Program folder listed below.", 4));
            _content.Controls.Add(Cap("Program folder:", 60));
            TextBox pf = Txt(opt.ProgramFolder, 80, 380); _content.Controls.Add(pf);
            _validate = delegate { opt.ProgramFolder = pf.Text.Trim().Length == 0 ? "Keyward Vault" : pf.Text.Trim(); return true; };
        }

        private void PagePasswords()
        {
            _content.Controls.Add(Para(
                "Setup creates a Master user (for emergency full access) and an Administrator user (for day-to-day administration). " +
                "Set their passwords now.", 4));
            _content.Controls.Add(Cap("Master password:", 66));
            TextBox m1 = Pw(86); _content.Controls.Add(m1);
            _content.Controls.Add(Cap("Confirm Master password:", 116));
            TextBox m2 = Pw(136); _content.Controls.Add(m2);
            _content.Controls.Add(Cap("Administrator password:", 176));
            TextBox a1 = Pw(196); _content.Controls.Add(a1);
            _content.Controls.Add(Cap("Confirm Administrator password:", 226));
            TextBox a2 = Pw(246); _content.Controls.Add(a2);
            _validate = delegate {
                if (m1.Text.Length < 6 || a1.Text.Length < 6) { Warn("Passwords must be at least 6 characters."); return false; }
                if (m1.Text != m2.Text) { Warn("The Master passwords do not match."); return false; }
                if (a1.Text != a2.Text) { Warn("The Administrator passwords do not match."); return false; }
                opt.MasterPassword = m1.Text; opt.AdminPassword = a1.Text; return true;
            };
        }
        private TextBox Pw(int top) { TextBox t = Txt("", top, 300); t.UseSystemPasswordChar = true; return t; }

        private void PageInstall()
        {
            _back.Enabled = false; _cancel.Enabled = false; _next.Enabled = false;
            Label lbl = Cap("Keyward Vault Setup is performing the requested operations...", 4);
            ProgressBar pb = new ProgressBar(); pb.Left = 0; pb.Top = 34; pb.Width = 624; pb.Height = 18; pb.Style = ProgressBarStyle.Marquee; pb.MarqueeAnimationSpeed = 40;
            TextBox logbox = new TextBox(); logbox.Multiline = true; logbox.ReadOnly = true; logbox.ScrollBars = ScrollBars.Vertical;
            logbox.Left = 0; logbox.Top = 64; logbox.Width = 624; logbox.Height = 200; logbox.Font = new Font("Consolas", 8.5f); logbox.BackColor = Color.White;
            _content.Controls.Add(lbl); _content.Controls.Add(pb); _content.Controls.Add(logbox);

            Action<string> report = delegate (string s) {
                try { logbox.BeginInvoke((MethodInvoker)delegate { logbox.AppendText(s + "\r\n"); }); } catch { }
            };

            Thread t = new Thread(delegate () {
                string err = null;
                try { Installer.Run(opt, report); }
                catch (Exception ex) { err = ex.ToString(); }
                try {
                    this.BeginInvoke((MethodInvoker)delegate {
                        pb.Style = ProgressBarStyle.Continuous; pb.Value = 100;
                        if (err != null) { report("ERROR: " + err); Warn("Install failed:\r\n" + err); _cancel.Enabled = true; _back.Enabled = true; }
                        else { _installed = true; _next.Enabled = true; _next.Text = "Next >"; report("\r\nInstallation complete. Click Next."); }
                    });
                } catch { }
            });
            t.IsBackground = true; t.Start();
        }

        private void PageDone()
        {
            _back.Enabled = false; _cancel.Enabled = false;
            Label h = Cap("Setup Complete", 6); h.Font = new Font("Segoe UI", 12f, FontStyle.Bold); h.AutoSize = true;
            _content.Controls.Add(h);
            _content.Controls.Add(Para(
                "Keyward Vault has been installed on this computer" +
                (opt.RegisterService ? " and the Vault service has been started." : ".") +
                "\r\n\r\nOpen \"Keyward Server Central Administration\" to watch the Vault run.", 44));
            Button admin = new Button(); admin.Text = "Open Server Central Administration"; admin.Left = 0; admin.Top = 130; admin.Width = 280; admin.Height = 30;
            admin.Click += delegate {
                try { System.Diagnostics.Process.Start(Path.Combine(Path.Combine(opt.InstallDir, "Server"), "KeywardServerAdmin.exe")); }
                catch (Exception ex) { Warn(ex.Message); }
            };
            _content.Controls.Add(admin);
            _restart = new CheckBox(); _restart.Text = "Yes, I want to restart my computer now"; _restart.Left = 0; _restart.Top = 180; _restart.Width = 360; _restart.Checked = false;
            _content.Controls.Add(_restart);
            _next.Text = "Finish"; _next.Enabled = true;
        }

        // ---------- helpers ----------
        private void Warn(string m) { MessageBox.Show(this, m, "Keyward Vault Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        private bool NonEmpty(string v, string what) { if (string.IsNullOrEmpty(v)) { Warn("Please choose a " + what + "."); return false; } return true; }
        private string PickFolder(string start)
        {
            FolderBrowserDialog d = new FolderBrowserDialog();
            try { if (Directory.Exists(start)) d.SelectedPath = start; } catch { }
            return d.ShowDialog() == DialogResult.OK ? d.SelectedPath : null;
        }

        private static string LicenseText()
        {
            return "KEYWARD VAULT — SOFTWARE LICENSE AGREEMENT\r\n\r\n" +
                "This is an independent, educational privileged-access-management project created by " +
                "M. Hasan Zafar (\"Keyward\"). It is not affiliated with, endorsed by, or derived from CyberArk " +
                "Software Ltd. or any other vendor.\r\n\r\n" +
                "1. GRANT. You are granted a non-exclusive license to install and use Keyward Vault for personal " +
                "learning, evaluation and lab use, free of charge.\r\n\r\n" +
                "2. NO WARRANTY. The software is provided \"as is\", without warranty of any kind. It models the " +
                "architecture of a PAM Vault for education and is not intended as a production secrets manager.\r\n\r\n" +
                "3. RESPONSIBLE USE. Install and use Keyward only on systems you own or are authorised to manage.\r\n\r\n" +
                "4. MIT-STYLE TERMS. You may study, modify and redistribute the source under the terms in the " +
                "project's LICENSE file.\r\n\r\nBy accepting, you agree to these terms.";
        }

        // ---------- silent / uninstall ----------
        private static void RunSilent(List<string> a)
        {
            InstallOptions o = new InstallOptions();
            foreach (string s in a)
            {
                int eq = s.IndexOf('=');
                if (eq <= 0) continue;
                string k = s.Substring(0, eq).TrimStart('-').ToLowerInvariant(), v = s.Substring(eq + 1);
                switch (k)
                {
                    case "installdir": o.InstallDir = v; break;
                    case "safesdir": o.SafesDir = v; break;
                    case "keysdir": o.KeysDir = v; break;
                    case "name": o.Name = v; break;
                    case "company": o.Company = v; break;
                    case "mode": o.Mode = v; break;
                    case "port": int.TryParse(v, out o.Port); break;
                    case "master": o.MasterPassword = v; break;
                    case "admin": o.AdminPassword = v; break;
                    case "service": o.RegisterService = (v != "0" && v.ToLowerInvariant() != "false"); break;
                    case "start": o.StartService = (v != "0" && v.ToLowerInvariant() != "false"); break;
                }
            }
            if (o.MasterPassword.Length == 0) o.MasterPassword = "ChangeMe123!";
            if (o.AdminPassword.Length == 0) o.AdminPassword = "ChangeMe123!";
            Console.WriteLine("Keyward Vault silent install -> " + o.InstallDir + " (" + o.Mode + ")");
            Installer.Run(o, delegate (string s) { Console.WriteLine("  " + s); });
            Console.WriteLine("Done.");
        }

        private static void RunUninstallConsole()
        {
            Installer.Uninstall(delegate (string s) { Console.WriteLine(s); });
        }
    }
}
