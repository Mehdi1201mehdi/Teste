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
