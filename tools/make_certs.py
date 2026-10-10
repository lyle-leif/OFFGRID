"""Certificates for the OFFGRID hub, so phones get a secure (https) connection over local
Wi-Fi. Phones need that for the offline copy and for GPS.

    .venv\\Scripts\\python tools\\make_certs.py          # create what's missing, refresh if the IP changed
    .venv\\Scripts\\python tools\\make_certs.py --force  # issue a new hub certificate

Creates certs/ (kept out of git):
  offgrid-ca.crt / .key   the hub's own certificate authority, made once. Each phone installs
                          offgrid-ca.crt once (the setup page explains how). It is limited by
                          name constraints to private network addresses and "localhost", so
                          even if the key leaked it could not impersonate real websites.
  hub.crt / hub.key       the hub's certificate for its current local IP addresses
                          (plus 192.168.137.1, the usual Windows Mobile Hotspot address).
Uses the openssl that comes with Git for Windows; no extra Python packages.
"""

import argparse
import ipaddress
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CERTS = ROOT / "certs"
CA_KEY, CA_CRT = CERTS / "offgrid-ca.key", CERTS / "offgrid-ca.crt"
HUB_KEY, HUB_CRT = CERTS / "hub.key", CERTS / "hub.crt"
HOTSPOT_IP = "192.168.137.1"  # Windows Mobile Hotspot's usual address
PRIVATE = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8")]


def openssl() -> str:
    for c in (shutil.which("openssl"), r"C:\Program Files\Git\usr\bin\openssl.exe",
              r"C:\Program Files\Git\mingw64\bin\openssl.exe"):
        if c and Path(c).exists():
            return c
    sys.exit("openssl not found. Install Git for Windows (it includes openssl).")


def run(*args: str) -> str:
    r = subprocess.run([openssl(), *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"openssl {' '.join(args[:2])} failed:\n{r.stderr}")
    return r.stdout


def local_ips() -> list[str]:
    ips = {HOTSPOT_IP, "127.0.0.1"}
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:  # the address of the interface that would carry traffic (no packet is sent)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(ip for ip in ips if any(ipaddress.ip_address(ip) in n for n in PRIVATE))


def make_ca() -> None:
    constraints = ",".join(
        [f"permitted;IP:{n.network_address}/{n.netmask}" for n in PRIVATE] + ["permitted;DNS:localhost"])
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "3650",
        "-keyout", str(CA_KEY), "-out", str(CA_CRT), "-subj", "/CN=OFFGRID Hub (local)/O=OFFGRID",
        "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
        "-addext", f"nameConstraints=critical,{constraints}")


def hub_cert_ok(ips: list[str]) -> bool:
    if not (HUB_CRT.exists() and HUB_KEY.exists()):
        return False
    san = run("x509", "-in", str(HUB_CRT), "-noout", "-ext", "subjectAltName")
    if any(f"IP Address:{ip}" not in san for ip in ips):
        return False
    end = run("x509", "-in", str(HUB_CRT), "-noout", "-enddate").strip().split("=", 1)[1]
    expires = datetime.strptime(end.replace("  ", " "), "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    return expires - datetime.now(timezone.utc) > timedelta(days=30)


def make_hub_cert(ips: list[str]) -> None:
    csr = CERTS / "hub.csr"
    ext = CERTS / "hub.ext"
    ext.write_text(
        "basicConstraints=CA:FALSE\n"
        "keyUsage=critical,digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
        "subjectAltName=" + ",".join([f"IP:{ip}" for ip in ips] + ["DNS:localhost"]) + "\n",
        encoding="ascii")
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", str(HUB_KEY), "-out", str(csr), "-subj", "/CN=OFFGRID Hub")
    run("x509", "-req", "-in", str(csr), "-CA", str(CA_CRT), "-CAkey", str(CA_KEY), "-CAcreateserial",
        "-out", str(HUB_CRT), "-days", "397", "-sha256", "-extfile", str(ext))
    csr.unlink(missing_ok=True)
    ext.unlink(missing_ok=True)


def fingerprint() -> str:
    return run("x509", "-in", str(CA_CRT), "-noout", "-fingerprint", "-sha256").strip().split("=", 1)[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="issue a new hub certificate even if the current one is fine")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    CERTS.mkdir(exist_ok=True)
    if not (CA_CRT.exists() and CA_KEY.exists()):
        make_ca()
        print("Created the hub's certificate authority (certs/offgrid-ca.crt). Phones install this once.")
    ips = local_ips()
    if args.force or not hub_cert_ok(ips):
        make_hub_cert(ips)
        print(f"Issued the hub certificate for: {', '.join(ips)}")
    if not args.quiet:
        print(f"CA fingerprint (SHA-256): {fingerprint()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
