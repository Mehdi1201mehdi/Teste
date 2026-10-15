from mobilelab.cli import main


def test_cli_simulated_flow(tmp_path, capsys):
    assert main(["--simulation", "devices"]) == 0
    out = capsys.readouterr().out
    assert "SIM-ANDROID-01" in out and "[SIMULATION]" in out

    dest = tmp_path / "bk"
    assert main(["--simulation", "backup", "SIM-ANDROID-01", str(dest),
                 "--path", "/sdcard/DCIM"]) == 0
    [backup] = list(dest.iterdir())
    assert main(["verify", str(backup)]) == 0
    assert "3/3" in capsys.readouterr().out

    report = tmp_path / "r.html"
    assert main(["inventory", str(backup), "--report", str(report)]) == 0
    assert "Sauvegarde MobileLab" in capsys.readouterr().out
    assert report.exists()


def test_cli_unknown_device(capsys):
    assert main(["--simulation", "backup", "NOPE", "/tmp/x"]) == 2
    assert "introuvable" in capsys.readouterr().err


def test_cli_manager_commands(tmp_path, capsys):
    assert main(["--simulation", "apps", "SIM-ANDROID-01"]) == 0
    assert "org.demo.notes" in capsys.readouterr().out
    assert main(["--simulation", "screenshot", "SIM-ANDROID-01", str(tmp_path)]) == 0
    assert list(tmp_path.glob("capture_*.png"))
    f = tmp_path / "doc.txt"
    f.write_text("x")
    assert main(["--simulation", "push", "SIM-ANDROID-01", str(f)]) == 0
    assert "/sdcard/Download/MobileLab/doc.txt" in capsys.readouterr().out


def test_cli_install_tools_requires_yes(capsys):
    assert main(["install-tools"]) == 1
    assert "--yes" in capsys.readouterr().out


def test_cli_duplicates(tmp_path, capsys):
    (tmp_path / "a").write_bytes(b"same")
    (tmp_path / "b").write_bytes(b"same")
    assert main(["duplicates", str(tmp_path)]) == 0
    assert "1 groupe(s)" in capsys.readouterr().out


def test_cli_survives_legacy_windows_console(monkeypatch):
    """Régression (CI Windows) : la console cp1252 ne sait pas afficher « → »."""
    import io
    import sys

    raw = io.BytesIO()
    console = io.TextIOWrapper(raw, encoding="cp1252", errors="strict")
    monkeypatch.setattr(sys, "stdout", console)
    assert main(["--simulation", "diagnose"]) == 0
    console.flush()
    assert b"MobileLab" in raw.getvalue()
    assert console.errors == "replace"  # tout autre caractère non affichable est remplacé
