"use client";

import { Button } from "@repo/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@repo/ui/components/dialog";
import { useEffect, useMemo, useRef } from "react";
import type { ReactCropperElement } from "react-cropper";
import Cropper from "react-cropper";

export function CropImageDialog({
	image,
	open,
	onOpenChange,
	onCrop,
}: {
	image: File | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCrop: (croppedImage: Blob | null) => void;
}) {
	const cropperRef = useRef<ReactCropperElement>(null);

	const getCroppedImage = async () => {
		const cropper = cropperRef.current?.cropper;

		const imageBlob = await new Promise<Blob | null>((resolve) => {
			cropper
				?.getCroppedCanvas({
					maxWidth: 256,
					maxHeight: 256,
				})
				.toBlob(resolve);
		});

		return imageBlob;
	};

	const imageSrc = useMemo(
		() => image && URL.createObjectURL(image),
		[image],
	);

	useEffect(() => {
		return () => {
			if (imageSrc) {
				URL.revokeObjectURL(imageSrc);
			}
		};
	}, [imageSrc]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Crop image</DialogTitle>
					<DialogDescription>
						Adjust the crop area, then save to upload the updated
						image.
					</DialogDescription>
				</DialogHeader>
				<div>
					{imageSrc && (
						<Cropper
							src={imageSrc}
							style={{ width: "100%" }}
							initialAspectRatio={1}
							aspectRatio={1}
							guides={true}
							ref={cropperRef}
						/>
					)}
				</div>
				<DialogFooter>
					<Button
						onClick={async () => {
							onCrop(await getCroppedImage());
							onOpenChange(false);
						}}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
