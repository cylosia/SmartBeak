"use client";

import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import { useTranslations } from "next-intl";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useState,
} from "react";

type ConfirmOptions = {
	title: string;
	message?: string;
	cancelLabel?: string;
	confirmLabel?: string;
	destructive?: boolean;
	onConfirm: () => Promise<void> | void;
};
const ConfirmationAlertContext = createContext<{
	confirm: (options: ConfirmOptions) => void;
}>({
	confirm: async () => false,
});

export function ConfirmationAlertProvider({ children }: PropsWithChildren) {
	const t = useTranslations();
	const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(
		null,
	);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const confirm = (options: ConfirmOptions) => {
		setConfirmOptions(options);
	};

	return (
		<ConfirmationAlertContext.Provider value={{ confirm }}>
			{children}

			<AlertDialog
				open={!!confirmOptions}
				onOpenChange={(open) =>
					setConfirmOptions(open || isSubmitting ? confirmOptions : null)
				}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmOptions?.title}
						</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogDescription>
						{confirmOptions?.message}
					</AlertDialogDescription>

					<AlertDialogFooter>
						<AlertDialogCancel>
							disabled={isSubmitting}
							{confirmOptions?.cancelLabel ??
								t("common.confirmation.cancel")}
						</AlertDialogCancel>
						<Button
							variant={
								confirmOptions?.destructive
									? "destructive"
									: "primary"
							}
							disabled={isSubmitting}
							onClick={async () => {
								if (!confirmOptions || isSubmitting) {
									return;
								}

								try {
									setIsSubmitting(true);
									await confirmOptions.onConfirm();
									setConfirmOptions(null);
								} finally {
									setIsSubmitting(false);
								}
							}}
						>
							{confirmOptions?.confirmLabel ??
								t("common.confirmation.confirm")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ConfirmationAlertContext.Provider>
	);
}

export const useConfirmationAlert = () => {
	const context = useContext(ConfirmationAlertContext);

	if (!context) {
		throw new Error(
			"useConfirmationAlert must be used within a ConfirmationAlertProvider",
		);
	}

	return context;
};
