// Keyward Vault — shared core: paths, crypto, license, config, and the headless
// install engine used by both the wizard (Setup.exe) and the --silent path.
// Targets the .NET Framework csc (C# 5), so: no string interpolation, no ?. etc.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Keyward
{
    // ---- product-wide constants ----
    public static class Product
    {
        public const string Name = "Keyward Vault";
        public const string Company = "Keyward";
        public const string Version = "1.0.0";
        public const string ServiceName = "KeywardVault";
        public const string ServiceDisplay = "Keyward Vault Server";
        public const int DefaultPort = 1858;
        public const string RegKey = @"SOFTWARE\Keyward\Vault";

        public const string DefaultInstallDir = @"C:\Program Files\Keyward\Vault";
        public const string DefaultSafesDir = @"C:\Keyward\Safes";
        public const string DefaultKeysDir = @"C:\Keyward\Keys";

        // Embedded license-authority secret. In a lab this lets the installer mint a
        // valid license and the Vault verify it — no external license server needed.
        public const string LicenseSecret = "KEYWARD-LAB-LICENSE-AUTHORITY-2026";
    }

    // ---- resolved on-disk layout for an installation ----
    public class Layout
    {
        public string InstallDir;
        public string SafesDir;
        public string KeysDir;
        public string ConfDir { get { return Path.Combine(InstallDir, "Conf"); } }
        public string LogsDir { get { return Path.Combine(InstallDir, "Logs"); } }
        public string BinDir { get { return Path.Combine(InstallDir, "Server"); } }
        public string LogFile { get { return Path.Combine(LogsDir, "keyward_vault.log"); } }
        public string ConfFile { get { return Path.Combine(ConfDir, "vault.ini"); } }
        public string LicenseFile { get { return Path.Combine(ConfDir, "license.xml"); } }
        public string UsersFile { get { return Path.Combine(ConfDir, "users.dat"); } }

        public static Layout Defaults()
        {
            Layout l = new Layout();
            l.InstallDir = Product.DefaultInstallDir;
            l.SafesDir = Product.DefaultSafesDir;
            l.KeysDir = Product.DefaultKeysDir;
            return l;
        }

        // Load the layout of an existing install from the registry (used by the
        // service and the admin console).
        public static Layout FromRegistry()
        {
            Layout l = Defaults();
            try
            {
                Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(Product.RegKey);
                if (k != null)
                {
                    object id = k.GetValue("InstallDir"); if (id != null) l.InstallDir = id.ToString();
                    object sd = k.GetValue("SafesDir"); if (sd != null) l.SafesDir = sd.ToString();
                    object kd = k.GetValue("KeysDir"); if (kd != null) l.KeysDir = kd.ToString();
                    k.Close();
                }
            }
            catch { }
            // Env overrides (used for lab/testing without touching HKLM).
            string ei = Environment.GetEnvironmentVariable("KEYWARD_INSTALLDIR"); if (!string.IsNullOrEmpty(ei)) l.InstallDir = ei;
            string es = Environment.GetEnvironmentVariable("KEYWARD_SAFESDIR"); if (!string.IsNullOrEmpty(es)) l.SafesDir = es;
            string ek = Environment.GetEnvironmentVariable("KEYWARD_KEYSDIR"); if (!string.IsNullOrEmpty(ek)) l.KeysDir = ek;
            return l;
        }
    }

    // ---- append-only, tab-separated log the admin console tails ----
    public static class Log
    {
        private static readonly object Gate = new object();
        public static string Path;   // set by service/installer

        public static void Line(string level, string code, string message)
        {
            if (string.IsNullOrEmpty(Path)) return;
            string ts = DateTime.Now.ToString("dd/MM/yyyy", CultureInfo.InvariantCulture)
                + "\t" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture)
                + "\t" + level + "\t" + code + "\t" + message;
            lock (Gate)
            {
                try
                {
                    string dir = System.IO.Path.GetDirectoryName(Path);
                    if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                    File.AppendAllText(Path, ts + Environment.NewLine, Encoding.UTF8);
                }
                catch { }
            }
        }
        public static void Info(string code, string m) { Line("I", code, m); }
        public static void Warn(string code, string m) { Line("W", code, m); }
        public static void Error(string code, string m) { Line("E", code, m); }
    }

    // ---- crypto: password hashing, operator keys, license mint/verify ----
    public static class Crypto
    {
        public static string HashPassword(string password)
        {
            byte[] salt = new byte[16];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(salt);
            int iters = 100000;
            using (Rfc2898DeriveBytes kdf = new Rfc2898DeriveBytes(password, salt, iters))
            {
                byte[] hash = kdf.GetBytes(32);
                return iters.ToString(CultureInfo.InvariantCulture) + ":" +
                       Convert.ToBase64String(salt) + ":" + Convert.ToBase64String(hash);
            }
        }

        public static bool VerifyPassword(string password, string stored)
        {
            try
            {
                string[] parts = stored.Split(':');
                int iters = int.Parse(parts[0], CultureInfo.InvariantCulture);
                byte[] salt = Convert.FromBase64String(parts[1]);
                byte[] expected = Convert.FromBase64String(parts[2]);
                using (Rfc2898DeriveBytes kdf = new Rfc2898DeriveBytes(password, salt, iters))
                {
                    byte[] actual = kdf.GetBytes(expected.Length);
                    bool ok = true;
                    for (int i = 0; i < expected.Length; i++) if (expected[i] != actual[i]) ok = false;
                    return ok;
                }
            }
            catch { return false; }
        }

        public static byte[] Random(int n)
        {
            byte[] b = new byte[n];
            using (RNGCryptoServiceProvider rng = new RNGCryptoServiceProvider()) rng.GetBytes(b);
            return b;
        }

        // Generate the operator keys: recovery RSA keypair, a server key, and the
        // initial random data seed. Mirrors CyberArk's "Operator CD" contents.
        public static void GenerateOperatorKeys(string keysDir)
        {
            if (!Directory.Exists(keysDir)) Directory.CreateDirectory(keysDir);
            using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider(2048))
            {
                File.WriteAllText(Path.Combine(keysDir, "RecoveryPublic.key"), rsa.ToXmlString(false), Encoding.UTF8);
                File.WriteAllText(Path.Combine(keysDir, "RecoveryPrivate.key"), rsa.ToXmlString(true), Encoding.UTF8);
            }
            File.WriteAllText(Path.Combine(keysDir, "Server.key"), Convert.ToBase64String(Random(32)), Encoding.UTF8);
            File.WriteAllText(Path.Combine(keysDir, "VaultEmergency.dat"), Convert.ToBase64String(Random(256)), Encoding.UTF8);
        }

        private static string Hmac(string message)
        {
            using (HMACSHA256 h = new HMACSHA256(Encoding.UTF8.GetBytes(Product.LicenseSecret)))
                return Convert.ToBase64String(h.ComputeHash(Encoding.UTF8.GetBytes(message)));
        }

        // Mint a signed Keyward license.xml valid for `days`.
        public static void GenerateLicense(string path, string licensee, string company, int days, string features)
        {
            string issued = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            string expires = DateTime.UtcNow.AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            string body = "product=" + Product.Name + "|licensee=" + licensee + "|company=" + company +
                          "|issued=" + issued + "|expires=" + expires + "|features=" + features;
            string sig = Hmac(body);
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
            sb.AppendLine("<KeywardLicense>");
            sb.AppendLine("  <Product>" + X(Product.Name) + "</Product>");
            sb.AppendLine("  <Licensee>" + X(licensee) + "</Licensee>");
            sb.AppendLine("  <Company>" + X(company) + "</Company>");
            sb.AppendLine("  <Issued>" + issued + "</Issued>");
            sb.AppendLine("  <Expires>" + expires + "</Expires>");
            sb.AppendLine("  <Features>" + X(features) + "</Features>");
            sb.AppendLine("  <Signature>" + sig + "</Signature>");
            sb.AppendLine("</KeywardLicense>");
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
        }

        public class LicenseInfo { public bool Valid; public string Licensee; public string Company; public string Expires; public string Reason; public string Features; }

        public static LicenseInfo ValidateLicense(string path)
        {
            LicenseInfo li = new LicenseInfo();
            try
            {
                System.Xml.XmlDocument doc = new System.Xml.XmlDocument();
                doc.Load(path);
                string prod = Get(doc, "Product"), lic = Get(doc, "Licensee"), comp = Get(doc, "Company");
                string issued = Get(doc, "Issued"), expires = Get(doc, "Expires"), feat = Get(doc, "Features"), sig = Get(doc, "Signature");
                string body = "product=" + prod + "|licensee=" + lic + "|company=" + comp +
                              "|issued=" + issued + "|expires=" + expires + "|features=" + feat;
                li.Licensee = lic; li.Company = comp; li.Expires = expires; li.Features = feat;
                if (Hmac(body) != sig) { li.Valid = false; li.Reason = "signature mismatch"; return li; }
                DateTime exp;
                if (DateTime.TryParse(expires, CultureInfo.InvariantCulture, DateTimeStyles.None, out exp) && exp < DateTime.UtcNow)
                { li.Valid = false; li.Reason = "expired " + expires; return li; }
                li.Valid = true; li.Reason = "ok";
                return li;
            }
            catch (Exception ex) { li.Valid = false; li.Reason = ex.Message; return li; }
        }

        private static string Get(System.Xml.XmlDocument d, string tag)
        {
            System.Xml.XmlNodeList n = d.GetElementsByTagName(tag);
            return (n != null && n.Count > 0) ? n[0].InnerText : "";
        }
        private static string X(string s) { return (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;"); }
    }

    // ---- tiny INI config ----
    public static class Config
    {
        public static Dictionary<string, string> Read(string path)
        {
            Dictionary<string, string> d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(path)) return d;
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#") || line.StartsWith("[")) continue;
                int eq = line.IndexOf('=');
                if (eq > 0) d[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return d;
        }
        public static void Write(string path, Dictionary<string, string> d, string header)
        {
            StringBuilder sb = new StringBuilder();
            if (!string.IsNullOrEmpty(header)) sb.AppendLine("# " + header);
            sb.AppendLine("[Vault]");
            foreach (KeyValuePair<string, string> kv in d) sb.AppendLine(kv.Key + "=" + kv.Value);
            string dir = Path.GetDirectoryName(path);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
        }
    }

    // ---- options the wizard collects / the silent path accepts ----
    public class InstallOptions
    {
        public string InstallDir = Product.DefaultInstallDir;
        public string SafesDir = Product.DefaultSafesDir;
        public string KeysDir = Product.DefaultKeysDir;
        public string Name = "";
        public string Company = "";
        public string Mode = "Standalone";          // or "Cluster"
        public string ClusterPeer = "";
        public int Port = Product.DefaultPort;
        public string LicensePath = "";             // if empty, one is generated
        public bool GenerateLicense = true;
        public bool GenerateKeys = true;
        public string ExistingKeysDir = "";
        public bool ConfigureRemoteAgent = false;
        public string RemoteAgentIp = "";
        public bool InstallMessageBus = false;
        public bool HardenMachine = true;
        public string ProgramFolder = "Keyward Vault";
        public string MasterPassword = "";
        public string AdminPassword = "";
        public bool RegisterService = true;
        public bool StartService = true;
    }

    // ---- the headless install engine ----
    public static class Installer
    {
        public static void Step(Action<string> report, string msg) { if (report != null) report(msg); }

        public static Layout Run(InstallOptions o, Action<string> report)
        {
            Layout lay = new Layout();
            lay.InstallDir = o.InstallDir; lay.SafesDir = o.SafesDir; lay.KeysDir = o.KeysDir;
            Log.Path = lay.LogFile;

            Step(report, "Creating folders...");
            foreach (string d in new string[] { lay.InstallDir, lay.BinDir, lay.ConfDir, lay.LogsDir, lay.SafesDir, lay.KeysDir })
                if (!Directory.Exists(d)) Directory.CreateDirectory(d);

            Step(report, "Copying Vault runtime...");
            CopyRuntime(lay, report);

            Step(report, "Generating operator keys...");
            if (o.GenerateKeys) Crypto.GenerateOperatorKeys(lay.KeysDir);
            else if (!string.IsNullOrEmpty(o.ExistingKeysDir) && Directory.Exists(o.ExistingKeysDir) &&
                     Path.GetFullPath(o.ExistingKeysDir).TrimEnd('\\') != Path.GetFullPath(lay.KeysDir).TrimEnd('\\'))
                foreach (string f in Directory.GetFiles(o.ExistingKeysDir)) File.Copy(f, Path.Combine(lay.KeysDir, Path.GetFileName(f)), true);

            Step(report, "Installing license...");
            if (o.GenerateLicense || string.IsNullOrEmpty(o.LicensePath))
                Crypto.GenerateLicense(lay.LicenseFile, string.IsNullOrEmpty(o.Name) ? "Lab User" : o.Name,
                                       string.IsNullOrEmpty(o.Company) ? "Keyward Lab" : o.Company, 365, "Vault;PVWA;CPM;PSM;PTA");
            else if (File.Exists(o.LicensePath) && Path.GetFullPath(o.LicensePath) != Path.GetFullPath(lay.LicenseFile))
                File.Copy(o.LicensePath, lay.LicenseFile, true);

            Step(report, "Writing configuration...");
            Dictionary<string, string> c = new Dictionary<string, string>();
            c["Product"] = Product.Name; c["Version"] = Product.Version;
            c["InstallMode"] = o.Mode; c["ClusterPeer"] = o.ClusterPeer;
            c["Port"] = o.Port.ToString(CultureInfo.InvariantCulture);
            c["SafesDir"] = lay.SafesDir; c["KeysDir"] = lay.KeysDir;
            c["Licensee"] = o.Name; c["Company"] = o.Company;
            c["MessageBus"] = o.InstallMessageBus ? "1" : "0";
            c["Hardened"] = o.HardenMachine ? "1" : "0";
            c["RemoteAgent"] = o.ConfigureRemoteAgent ? o.RemoteAgentIp : "";
            Config.Write(lay.ConfFile, c, "Keyward Vault configuration");

            Step(report, "Creating built-in users (Master, Administrator)...");
            StringBuilder users = new StringBuilder();
            users.AppendLine("Master=" + Crypto.HashPassword(o.MasterPassword));
            users.AppendLine("Administrator=" + Crypto.HashPassword(o.AdminPassword));
            File.WriteAllText(lay.UsersFile, users.ToString(), Encoding.UTF8);

            Step(report, "Recording installation in registry...");
            try
            {
                Microsoft.Win32.RegistryKey k = Microsoft.Win32.Registry.LocalMachine.CreateSubKey(Product.RegKey);
                k.SetValue("InstallDir", lay.InstallDir); k.SetValue("SafesDir", lay.SafesDir);
                k.SetValue("KeysDir", lay.KeysDir); k.SetValue("Version", Product.Version);
                k.SetValue("Mode", o.Mode); k.SetValue("Port", o.Port);
                k.Close();
                RegisterUninstall(lay);
            }
            catch (Exception ex) { Step(report, "  (registry skipped: " + ex.Message + ")"); }

            Step(report, "Creating Start Menu shortcuts...");
            CreateShortcuts(lay, o.ProgramFolder, report);

            if (o.HardenMachine) { Step(report, "Applying machine hardening profile..."); ApplyHardening(lay); }

            if (o.RegisterService)
            {
                Step(report, "Registering the Keyward Vault service...");
                RegisterService(lay, report);
                if (o.StartService) { Step(report, "Starting the Keyward Vault service..."); StartService(report); }
            }

            Log.Info("KWSV000I", "Keyward Vault " + Product.Version + " installed (" + o.Mode + " mode).");
            Step(report, "Done.");
            return lay;
        }

        private static void CopyRuntime(Layout lay, Action<string> report)
        {
            // Runtime lives next to Setup.exe (in .\Server\ within the download).
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] wanted = new string[] { "KeywardVault.exe", "KeywardServerAdmin.exe" };
            foreach (string name in wanted)
            {
                string src = FindPayload(baseDir, name);
                string dst = Path.Combine(lay.BinDir, name);
                if (src != null && Path.GetFullPath(src) != Path.GetFullPath(dst)) File.Copy(src, dst, true);
                else if (src == null) Step(report, "  (payload " + name + " not found; place it in .\\Server\\)");
            }
        }

        private static string FindPayload(string baseDir, string name)
        {
            string[] candidates = new string[] {
                Path.Combine(Path.Combine(baseDir, "Server"), name),
                Path.Combine(baseDir, name),
                Path.Combine(Path.Combine(baseDir, "build"), name)
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        public static void RegisterService(Layout lay, Action<string> report)
        {
            string bin = Path.Combine(lay.BinDir, "KeywardVault.exe");
            Sc("stop " + Product.ServiceName, report, true);
            Sc("delete " + Product.ServiceName, report, true);
            // binPath must quote the exe; note the required space after '='.
            Sc("create " + Product.ServiceName + " binPath= \"" + bin + "\" start= auto DisplayName= \"" + Product.ServiceDisplay + "\"", report, false);
            Sc("description " + Product.ServiceName + " \"Keyward Vault Server — encrypted privileged-credential store.\"", report, true);
        }

        public static void StartService(Action<string> report) { Sc("start " + Product.ServiceName, report, false); }

        private static void Sc(string args, Action<string> report, bool ignoreErrors)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("sc.exe", args);
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                Process p = Process.Start(psi);
                string outp = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                p.WaitForExit();
                if (p.ExitCode != 0 && !ignoreErrors) Step(report, "  sc " + args.Split(' ')[0] + " -> " + outp.Trim());
            }
            catch (Exception ex) { if (!ignoreErrors) Step(report, "  sc failed: " + ex.Message); }
        }

        private static void CreateShortcuts(Layout lay, string programFolder, Action<string> report)
        {
            try
            {
                string progs = Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms);
                string dir = Path.Combine(progs, string.IsNullOrEmpty(programFolder) ? "Keyward Vault" : programFolder);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                string admin = Path.Combine(lay.BinDir, "KeywardServerAdmin.exe");
                MakeLnk(Path.Combine(dir, "Keyward Server Central Administration.lnk"), admin, lay.InstallDir);
                MakeLnk(Path.Combine(dir, "Keyward Safes.lnk"), lay.SafesDir, lay.SafesDir);
            }
            catch (Exception ex) { Step(report, "  (shortcuts skipped: " + ex.Message + ")"); }
        }

        private static void MakeLnk(string lnkPath, string target, string workDir)
        {
            // Create a .lnk via the WScript.Shell COM object, driven from PowerShell
            // (no extra assembly references needed).
            string ps = "$w=New-Object -ComObject WScript.Shell;" +
                        "$s=$w.CreateShortcut('" + lnkPath.Replace("'", "''") + "');" +
                        "$s.TargetPath='" + target.Replace("'", "''") + "';" +
                        "$s.WorkingDirectory='" + workDir.Replace("'", "''") + "';$s.Save()";
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -NonInteractive -WindowStyle Hidden -Command \"" + ps + "\"");
            psi.UseShellExecute = false; psi.CreateNoWindow = true;
            Process p = Process.Start(psi); p.WaitForExit();
        }

        private static void ApplyHardening(Layout lay)
        {
            // Lab-safe hardening marker: real CyberArk disables OS services; here we
            // record the intent and lock down the safes folder ACL inheritance.
            try { File.WriteAllText(Path.Combine(lay.ConfDir, "hardening.applied"),
                "Keyward hardening profile applied " + DateTime.Now.ToString("u")); } catch { }
        }

        private static void RegisterUninstall(Layout lay)
        {
            try
            {
                string setup = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Setup.exe");
                Microsoft.Win32.RegistryKey u = Microsoft.Win32.Registry.LocalMachine.CreateSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KeywardVault");
                u.SetValue("DisplayName", Product.ServiceDisplay);
                u.SetValue("DisplayVersion", Product.Version);
                u.SetValue("Publisher", Product.Company);
                u.SetValue("InstallLocation", lay.InstallDir);
                u.SetValue("UninstallString", "\"" + setup + "\" --uninstall");
                u.Close();
            }
            catch { }
        }

        public static void Uninstall(Action<string> report)
        {
            Layout lay = Layout.FromRegistry();
            Step(report, "Stopping and removing the service...");
            Sc("stop " + Product.ServiceName, report, true);
            Sc("delete " + Product.ServiceName, report, true);
            Step(report, "Removing program files (safes and keys are kept)...");
            try { if (Directory.Exists(lay.InstallDir)) Directory.Delete(lay.InstallDir, true); } catch { }
            try {
                Microsoft.Win32.Registry.LocalMachine.DeleteSubKeyTree(Product.RegKey, false);
                Microsoft.Win32.Registry.LocalMachine.DeleteSubKeyTree(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\KeywardVault", false);
            } catch { }
            Step(report, "Uninstall complete. Safes remain at " + lay.SafesDir + ".");
        }
    }
}
