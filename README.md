# WebGPU Monte Carlo π - Extreme Optimization Mode

モンテカルロ法による円周率計算を、WebGPUの最新機能を用いて極限まで最適化したWebアプリケーションです。

## 🚀 Features

- **Extreme Optimization (Integer-Only Kernel)**:
  - 浮動小数点演算を完全に排除し、`u32` 整数演算のみで判定を行う超高速ロジック。
  - `u16` 座標系 (0-32767) を使用。
- **Ultra-Lightweight LCG**:
  - PCG Hashすら上回る速度の、1命令(MAD)で動作する `vec4` 並列化 LCG 乱数生成器。
- **Memory Bandwidth Optimization**:
  - 計算は全数実行しますが、可視化用の書き込みは `f16` (半精度) に圧縮し、かつ間引き処理を行うことでVRAM帯域の枯渇を防ぎます。
- **Advanced GPU Techniques**:
  - Coalesced Memory Access (SoA)
  - Workgroup / Subgroup Reduction
  - Programmable Vertex Pulling
- **Minimal Premium UI**:
  - Deep Void Black テーマとGlassmorphismデザイン。
  - リアルタイム収束グラフと、信頼性検証機能。

## 🛠️ Requirements

- **WebGPU Support**: Chrome 113+, Edge 113+ (Canary推奨)
- **Feature `shader-f16`**: 必須 (M1/M2 Mac, RTX 3000+, Radeon 6000+ 等で動作)

## 📦 Architecture

- **100% Client-Side**: サーバー通信なし。全ての計算はあなたのGPUで行われます。
- **Stack**: Vanilla JS (No Framework), WebGPU API (WGSL).

## 🏃 How to Run

1. 依存関係をインストールします（初回のみ）。
   ```powershell
   npm install
   ```

2. 開発サーバーを起動します。
   ```powershell
   npm run dev
   ```
   - 実行すると自動的にブラウザで `http://localhost:5173` が開きます。
   - WebGPU対応ブラウザ（Chrome等）で動作することを確認してください。

## 🔬 Verification

「Verify」ボタンを押すと、CPU (JavaScript) で全く同じアルゴリズムを検証し、GPUの動作が数学的に正しいことを確認できます。

## 🌐 Deployment (GitHub Pages)

このプロジェクトは GitHub Actions を利用して、GitHub Pages 上で自動公開できます。以下の手順で公開してください。

### 1. GitHub リポジトリの準備
1. [GitHub](https://github.com/) で新しいリポジトリ（名称: `32_sci`）を **Public** で作成します。
2. ローカルのターミナルで以下のコマンドを実行し、コードをプッシュします：
   ```powershell
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/[あなたのユーザー名]/32_sci.git
   git push -u origin main
   ```

### 2. GitHub Pages の設定
1. GitHub リポジトリのページを開き、**Settings** タブをクリックします。
2. 左メニューの **Pages** を選択します。
3. **Build and deployment > Source** のプルダウンメニューを `Deploy from a branch` から **`GitHub Actions`** に変更します。
   - ※これにより、リポジトリ内の `.github/workflows/deploy.yml` が自動的に使用されるようになります。

### 3. デプロイの確認
1. ヘッダーの **Actions** タブをクリックすると、デプロイ（`Deploy to GitHub Pages`）の進捗が確認できます。
2. 全てのステップが完了（緑のチェック）したら、GitHub Pages セクションに表示されたURL（通常は `https://[ユーザー名].github.io/32_sci/`）にアクセスしてください。

> [!IMPORTANT]
> **WebGPU の注意点**: GitHub Pages (HTTPS経由) で公開する場合、WebGPU はセキュアなコンテキストでのみ動作するため、問題なく実行可能です。
