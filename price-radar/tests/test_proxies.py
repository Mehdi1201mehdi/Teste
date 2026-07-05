"""Tests des parseurs de sources de proxies (texte + Geonode JSON) et du
scoring — hors ligne, aucun appel réseau."""
from app.proxies.manager import (detect_protocol, parse_geonode,
                                 parse_proxy_list, parse_source_body,
                                 score_from_latency)


def test_parse_text_with_and_without_scheme():
    text = """
    # commentaire
    1.2.3.4:8080
    socks5://5.6.7.8:1080
    9.10.11.12 3128
    invalide
    13.14.15.16:99999
    """
    res = parse_proxy_list(text, "http")
    assert ("http", "1.2.3.4", 8080) in res
    assert ("socks5", "5.6.7.8", 1080) in res       # schéma explicite prioritaire
    assert ("http", "9.10.11.12", 3128) in res
    assert all(p[2] < 65536 for p in res)            # port hors limite exclu


def test_parse_geonode_json_multi_protocol():
    payload = ('{"data":[{"ip":"1.1.1.1","port":"8080","protocols":["http","socks5"]},'
               '{"ip":"2.2.2.2","port":3128,"protocols":["socks4"]},'
               '{"ip":"","port":"80","protocols":["http"]}]}')
    res = parse_geonode(payload, "http")
    assert ("http", "1.1.1.1", 8080) in res
    assert ("socks5", "1.1.1.1", 8080) in res         # 2 protocoles -> 2 entrées
    assert ("socks4", "2.2.2.2", 3128) in res
    assert not any(host == "" for _, host, _ in res)  # entrée sans IP ignorée


def test_parse_geonode_bad_json_returns_empty():
    assert parse_geonode("pas du json", "http") == []


def test_parse_source_body_dispatch():
    assert parse_source_body("1.2.3.4:80", "http", "text") == [("http", "1.2.3.4", 80)]
    geo = parse_source_body('{"data":[{"ip":"3.3.3.3","port":"9000","protocols":["http"]}]}',
                            "http", "geonode")
    assert geo == [("http", "3.3.3.3", 9000)]


def test_detect_protocol_priority():
    assert detect_protocol("socks5", "http") == "socks5"   # schéma prioritaire
    assert detect_protocol(None, "socks4") == "socks4"     # sinon protocole source
    assert detect_protocol(None, "n/a") == "http"          # défaut


def test_scoring_latency_ordering():
    fast = score_from_latency(100, 10, 0)
    slow = score_from_latency(4000, 1, 5)
    assert fast > slow and 1 <= slow <= 100 and fast <= 100
