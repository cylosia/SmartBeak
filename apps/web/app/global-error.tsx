"use client";

export default function GlobalError({
	error: _error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
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
					<h2
						style={{
							fontSize: "1.5rem",
							fontWeight: 600,
							marginBottom: "0.5rem",
						}}
					>
						Something went wrong
					</h2>
					<p
						style={{
							color: "#666",
							marginBottom: "1.5rem",
						}}
					>
						An unexpected error occurred. Please try again.
					</p>
					<button
						type="button"
						onClick={reset}
						style={{
							padding: "0.5rem 1.5rem",
							borderRadius: "0.375rem",
							border: "1px solid #ddd",
							background: "#fff",
							cursor: "pointer",
							fontSize: "0.875rem",
						}}
					>
						Try Again
					</button>
				</div>
			</body>
		</html>
	);
}
