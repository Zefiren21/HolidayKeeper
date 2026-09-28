# PyInstaller build for a single-file HolidayKeeper executable.
# Build with:  pyinstaller HolidayKeeper.spec   ->  dist/HolidayKeeper(.exe)

a = Analysis(
    ["server.py"],
    datas=[("static", "static")],
    excludes=["tkinter", "unittest", "pydoc"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="HolidayKeeper",
    console=True,  # the window shows the phone URL; closing it stops the server
    upx=False,
)
