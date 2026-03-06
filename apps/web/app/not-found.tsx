import Link from "next/link";

export default function NotFoundPage() {
	return (
		<html lang="en">
			<body>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "100vh",
						fontFamily: "system-ui, sans-serif",
						padding: "2rem",
						textAlign: "center",
					}}
				>
					<h1
						style={{
							fontSize: "3rem",
							fontWeight: 700,
							marginBottom: "0.5rem",
						}}
					>
						404
					</h1>
					<p style={{ color: "#666", marginBottom: "1.5rem" }}>
						The page you&apos;re looking for could not be found.
					</p>
					<Link
						href="/"
						style={{
							padding: "0.5rem 1.5rem",
							borderRadius: "0.375rem",
							border: "1px solid #ddd",
							background: "#fff",
							color: "#111",
							textDecoration: "none",
							fontSize: "0.875rem",
						}}
					>
						Go Home
					</Link>
				</div>
			</body>
		</html>
	);
}
