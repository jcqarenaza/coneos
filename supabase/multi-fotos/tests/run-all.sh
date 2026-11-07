#!/usr/bin/env bash
# Recrea la base sintética, aplica 01 y corre las pruebas. Requiere PostgreSQL en /tmp:54399.
set -e; cd "$(dirname "$0")"
P="psql -h /tmp -p 54399 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists mf" -c "create database mf" 2>/dev/null
$P -d mf -f 00-base-sintetica.sql
$P -d mf -f ../01-multi-fotos-correccion.sql
python3 -I test-integridad.py
