# flake.nix

{
  description = "A development shell for the Jigong News Python project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # 定義我們需要的 Python 版本和基礎套件
        python-with-packages = pkgs.python311.withPackages (ps: [
          ps.pip
          ps.setuptools
          ps.wheel
        ]);

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            python-with-packages  # 將帶有 pip 的 Python 加入環境
            pkgs.gcloud           # (可選) 也可以將 gcloud SDK 加入
          ];

          # 當進入這個 shell 時，自動創建並啟用 Python 虛擬環境
          shellHook = ''
            # 設定 Python 虛擬環境的路徑
            VENV_DIR=".venv"

            # 如果虛擬環境不存在，則創建它
            if [ ! -d "$VENV_DIR" ]; then
              echo "Creating Python virtual environment in $VENV_DIR..."
              ${python-with-packages}/bin/python -m venv $VENV_DIR
            fi

            # 啟動虛擬環境
            source $VENV_DIR/bin/activate
            echo "Python virtual environment activated."

            # (可選) 自動安裝 requirements.txt 中的依賴
            # pip install -r requirements.txt
          '';
        };
      }
    );
}