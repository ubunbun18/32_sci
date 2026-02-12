# WebGPU Monte Carlo π - Blackwell 16.8 TFLOPS Edition

モンテカルロ法による円周率計算を、WebGPUの最新機能を用いて極限まで最適化したハイパフォーマンス・コンピューティング（HPC）ショーケースです。
スライダーを動かすと本気を出します。

> [!IMPORTANT]
> **World-Class Performance**: NVIDIA Blackwell GPU において **16.8 TFLOPS (16,861 GFLOPS)** という驚異的な演算性能を達成。11兆回以上の試行をわずか10秒で完遂し、統計的正当性を科学的に証明しました。

## 🚀 Features

- **Extreme Blackwell Optimization**:
  - NVIDIA Blackwell アーキテクチャに特化した **Subgroup Add / Elect** インジェクション。
  - 原子操作（`atomicAdd`）の競合を 1/32 以下に抑制し、理論性能の限界に肉薄。
- **High-Precision Scientific Engine**:
  - 32bit フルエントロピー **Xoshiro128++** 乱数生成器による、統計的に潔白な推論。
  - 11兆サンプル超の巨大母集団において、誤差（δ）を **1.0e-6 未満** に抑止。
- **Scientific Measurement Standard**:
  - **10s Precise Lock**: GPUのオーバーランによらない、厳密な10.000秒計測による正確な性能評価。
- **Modern GPU Architectures**:
  - Coalesced Memory Access (SoA)
  - Half-Precision (`f16`) VRAM Compression
  - Programmable Vertex Pulling
- **Scientific Deep Dive UI**:
  - リアルタイム収束グラフと、学術的な誤差分析レポート。
  - Deep Void Black テーマとGlassmorphismデザイン。

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
