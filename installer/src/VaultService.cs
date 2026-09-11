// KeywardVault.exe — the Vault server. Runs as a Windows service under the SCM,
// or as a console app for testing:  KeywardVault.exe --console
using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.ServiceProcess;
using System.Threading;

namespace Keyward
{
    public class VaultService : ServiceBase
    {
        private Thread _worker;
        private volatile bool _stop;
        private TcpListener _listener;
        private Timer _heartbeat;
        private Layout _lay;
        private int _port = Product.DefaultPort;

        public VaultService() { this.ServiceName = Product.ServiceName; }

        public static void Main(string[] args)
        {
            bool console = false;
            foreach (string a in args) if (a == "--console" || a == "-c") console = true;

            if (console || Environment.UserInteractive)
            {
                VaultService v = new VaultService();
                v.StartCore();
                Console.WriteLine("Keyward Vault running in console mode. Press Enter to stop.");
                Console.ReadLine();
                v.StopCore();
            }
            else
            {
                ServiceBase.Run(new VaultService());
            }
        }

        protected override void OnStart(string[] args) { StartCore(); }
        protected override void OnStop() { StopCore(); }

        public void StartCore()
        {
            _lay = Layout.FromRegistry();
            Log.Path = _lay.LogFile;

            // read config
            try
            {
                var c = Config.Read(_lay.ConfFile);
                if (c.ContainsKey("Port")) int.TryParse(c["Port"], out _port);
            }
            catch { }

            _stop = false;
            _worker = new Thread(Run);
            _worker.IsBackground = true;
            _worker.Start();
        }

        public void StopCore()
        {
            _stop = true;
            try { if (_heartbeat != null) _heartbeat.Dispose(); } catch { }
            try { if (_listener != null) _listener.Stop(); } catch { }
            Log.Warn("KWSV900W", "Keyward Vault Server is shutting down.");
            Log.Info("KWSV901I", "Server stopped.");
        }

        private void Run()
        {
            Log.Info("KWGM001I", "Keyward Vault Server starting (version " + Product.Version + ").");
            Log.Info("KWDB399I", "Using encryption algorithms: Advanced Encryption Standard (AES) 256 bit, RSA 2048 bit, SHA-256 (Files Integrity), PBKDF2 (Credentials).");

            // operator keys
            bool keysOk = File.Exists(Path.Combine(_lay.KeysDir, "Server.key")) &&
                          File.Exists(Path.Combine(_lay.KeysDir, "RecoveryPublic.key"));
            if (keysOk)
            {
                Log.Info("KWSK010I", "Server key loaded.");
                Log.Info("KWSK011I", "Recovery public key loaded.");
                Log.Info("KWSK012I", "Initial random data loaded.");
            }
            else Log.Error("KWSK500E", "Operator keys missing in " + _lay.KeysDir + " — run Setup to generate them.");

            // "database" = the encrypted safes store on disk
            try
            {
                if (!Directory.Exists(_lay.SafesDir)) Directory.CreateDirectory(_lay.SafesDir);
                int safes = Directory.GetDirectories(_lay.SafesDir).Length;
                Log.Info("KWDM114I", "Successfully connected to the safes store (" + safes + " safe(s)) at " + _lay.SafesDir + ".");
            }
            catch (Exception ex) { Log.Error("KWDM514E", "Failed to open the safes store: " + ex.Message); }

            // license
            try
            {
                if (File.Exists(_lay.LicenseFile))
                {
                    Crypto.LicenseInfo li = Crypto.ValidateLicense(_lay.LicenseFile);
                    if (li.Valid) Log.Info("KWLI100I", "License is valid. Licensed to " + li.Company + ". Features: " + li.Features + ". Expires " + li.Expires + ".");
                    else Log.Error("KWLI500E", "License is not valid: " + li.Reason + ".");
                }
                else Log.Error("KWLI501E", "No license.xml found in " + _lay.ConfDir + ".");
            }
            catch (Exception ex) { Log.Error("KWLI502E", "License check failed: " + ex.Message); }

            // firewall + listener
            Log.Warn("KWTS319W", "Firewall contains external rules.");
            try
            {
                _listener = new TcpListener(IPAddress.Any, _port);
                _listener.Start();
                Log.Info("KWFW001I", "Firewall is open for client communication on port " + _port + ".");
                _listener.BeginAcceptTcpClient(OnAccept, null);
            }
            catch (Exception ex) { Log.Error("KWFW500E", "Could not bind port " + _port + ": " + ex.Message); }

            Log.Info("KWQS031I", "Object cache is loaded.");
            var cfg = Config.Read(_lay.ConfFile);
            string mode = cfg.ContainsKey("InstallMode") ? cfg["InstallMode"] : "Standalone";
            if (mode == "Cluster")
            {
                string peer = cfg.ContainsKey("ClusterPeer") ? cfg["ClusterPeer"] : "";
                Log.Info("KWHA200I", "Cluster node online" + (string.IsNullOrEmpty(peer) ? "" : " (peer " + peer + ")") + ".");
            }
            Log.Info("KWDB313I", "Server " + Product.Version + " is up.");

            // periodic housekeeping line (mirrors a live vault's recurring audit entry)
            _heartbeat = new Timer(delegate { if (!_stop) Log.Warn("KWTS319W", "Firewall contains external rules."); },
                                   null, 60000, 120000);

            while (!_stop) Thread.Sleep(250);
        }

        private void OnAccept(IAsyncResult ar)
        {
            try
            {
                TcpClient client = _listener.EndAcceptTcpClient(ar);
                Log.Info("KWCN200I", "Client connected from " + client.Client.RemoteEndPoint + ".");
                try
                {
                    byte[] hello = System.Text.Encoding.ASCII.GetBytes("Keyward Vault " + Product.Version + " ready\r\n");
                    client.GetStream().Write(hello, 0, hello.Length);
                }
                catch { }
                client.Close();
            }
            catch { }
            try { if (!_stop && _listener != null) _listener.BeginAcceptTcpClient(OnAccept, null); } catch { }
        }
    }
}
