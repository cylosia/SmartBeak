"use client";

import { Button } from "@repo/ui/components/button";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation } from "@tanstack/react-query";
import { CreditCardIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export function CustomerPortalButton({ purchaseId }: { purchaseId: string }) {
	const t = useTranslations();
	const createCustomerPortalMutation = useMutation(
		orpc.payments.createCustomerPortalLink.mutationOptions(),
	);

	const createCustomerPortal = async () => {
		try {
			const { customerPortalLink } =
				await createCustomerPortalMutation.mutateAsync({
					purchaseId,
					redirectUrl: window.location.href,
				});

			window.location.href = customerPortalLink;
		} catch {
			toast.error(
				t(
					"settings.billing.createCustomerPortal.notifications.error.title",
				),
			);
		}
	};

	return (
		<Button
			variant="secondary"
			size="sm"
			onClick={() => createCustomerPortal()}
			loading={createCustomerPortalMutation.isPending}
		>
			<CreditCardIcon className="mr-2 size-4" />
			{t("settings.billing.createCustomerPortal.label")}
		</Button>
	);
}
